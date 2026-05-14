import { Codex, type Thread } from "@openai/codex-sdk";
import { codexLoginStatus } from "./codex-auth";
import {
  buildCodexGrafanaErrorPrompt,
  buildCodexGrafanaPrompt,
  buildCodexGrafanaResultPrompt,
  buildEvidenceSummary,
  buildFactualRepairPrompt,
  codexGrafanaSchema,
  parseCanvasInstructions,
  parseCodexToolCall,
  renderFactualAnswer,
  summarizePrometheusResult,
  validateFactualAnswer,
} from "./codex-prompts";
import {
  grafanaPrometheusLabelValues,
  grafanaPrometheusQuery,
  grafanaPrometheusQueryRange,
  grafanaPrometheusSeries,
} from "./grafana";
import { json, parseJson } from "./http";
import type { ChatRequest, ChatStatus, ConversationEntry, EvidenceSummary, TurnEvidence } from "./types";
import { getString } from "./utils";

const codex = new Codex();
let codexThread: Thread | null = null;
let conversationSummary = "";
let conversationHistory: ConversationEntry[] = [];

const contextLimitTokens = Number(Bun.env.CODEX_CHAT_CONTEXT_LIMIT_TOKENS ?? 128_000);
const compressionThresholdRatio = Number(Bun.env.CODEX_CHAT_COMPRESSION_THRESHOLD_RATIO ?? 0.7);
const retainedHistoryEntries = Number(Bun.env.CODEX_CHAT_RETAINED_HISTORY_ENTRIES ?? 6);

function estimateConversationSize(entries = conversationHistory) {
  return conversationSummary.length + entries.reduce((size, entry) => size + entry.role.length + entry.text.length + 2, 0);
}

function estimateConversationTokens(entries = conversationHistory) {
  return Math.ceil(estimateConversationSize(entries) / 4);
}

function shouldCompressConversation(entries = conversationHistory) {
  return estimateConversationTokens(entries) >= contextLimitTokens * compressionThresholdRatio;
}

function formatConversationEntries(entries: ConversationEntry[]) {
  return entries.map((entry) => `${entry.role.toUpperCase()}: ${entry.text}`).join("\n\n");
}

function getCodexThread() {
  codexThread =
    codexThread ??
    codex.startThread({
      approvalPolicy: "never",
      sandboxMode: "read-only",
      skipGitRepoCheck: true,
      workingDirectory: process.cwd(),
    });

  return codexThread;
}

function buildConversationContextPrompt(message: string) {
  const recentHistory = formatConversationEntries(conversationHistory);
  const summary = conversationSummary || "No compressed conversation summary yet.";

  return `Compressed conversation summary:
${summary}

Recent conversation turns:
${recentHistory || "No recent turns yet."}

Current user message:
${message}`;
}

async function withStatusHeartbeat<T>(work: Promise<T>, onStatus: ChatStatus | undefined, message: string) {
  const startedAt = Date.now();
  const timer = onStatus
    ? setInterval(() => {
        const elapsedSeconds = Math.max(5, Math.round((Date.now() - startedAt) / 1000));

        onStatus(`${message} (${elapsedSeconds}s elapsed)`);
      }, 5000)
    : undefined;

  try {
    return await work;
  } finally {
    if (timer) {
      clearInterval(timer);
    }
  }
}

function buildCompressionPrompt(entriesToCompress: ConversationEntry[]) {
  const existingSummary = conversationSummary || "No prior summary.";
  const transcript = formatConversationEntries(entriesToCompress);

  return `Compress this OMG chat history into a concise working-memory summary for future telemetry/Grafana assistant turns.

Keep durable user goals, unresolved questions, important conclusions, PromQL or metric discoveries, assumptions, and any constraints that future answers need. Drop small talk, duplicate details, transient UI/status messages, and obsolete intermediate tool errors unless still relevant.

Existing summary:
${existingSummary}

New transcript to fold in:
${transcript}

Return only the updated summary. Use compact bullets if helpful.`;
}

async function compressConversationIfNeeded(onStatus?: ChatStatus) {
  if (!shouldCompressConversation() || conversationHistory.length <= retainedHistoryEntries) {
    return false;
  }

  onStatus?.("Compressing older conversation turns into memory");

  const entriesToCompress = conversationHistory.slice(0, -retainedHistoryEntries);
  const retainedEntries = conversationHistory.slice(-retainedHistoryEntries);
  const compressionThread = codex.startThread({
    approvalPolicy: "never",
    sandboxMode: "read-only",
    skipGitRepoCheck: true,
    workingDirectory: process.cwd(),
  });
  const turn = await withStatusHeartbeat(
    compressionThread.run(buildCompressionPrompt(entriesToCompress)),
    onStatus,
    "Waiting for Codex to compress older conversation turns",
  );
  const summary = getString(turn.finalResponse);

  if (summary) {
    conversationSummary = summary;
  }

  conversationHistory = retainedEntries;
  codexThread = null;

  return true;
}

async function runCodexWithGrafanaTools(message: string, onStatus?: ChatStatus) {
  const compressed = await compressConversationIfNeeded(onStatus);
  const thread = getCodexThread();
  const conversationContext = buildConversationContextPrompt(message);
  const evidence: TurnEvidence = { queries: new Set(), queryResults: [] };
  let prompt = buildCodexGrafanaPrompt(conversationContext);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    onStatus?.(attempt === 0 ? "Asking Codex what evidence is needed" : "Continuing the investigation with new evidence");
    const turn = await withStatusHeartbeat(
      thread.run(prompt, { outputSchema: codexGrafanaSchema }),
      onStatus,
      attempt === 0 ? "Waiting for Codex to choose the first evidence step" : "Waiting for Codex to interpret the latest evidence",
    );
    const toolCall = parseCodexToolCall(turn.finalResponse);
    const action = getString(toolCall.action);
    onStatus?.(`Codex selected ${action || "an unsupported action"}`);

    if (action === "answer") {
      onStatus?.("Validating observations against executed evidence");
      const issues = validateFactualAnswer(toolCall, evidence);

      if (issues.length > 0) {
        onStatus?.("Repairing unsupported or overconfident claims");
        prompt = buildFactualRepairPrompt(conversationContext, toolCall, evidence, issues);
        continue;
      }

      onStatus?.("Preparing the final answer and visuals");
      const answer = renderFactualAnswer(toolCall);

      return {
        canvas: parseCanvasInstructions(toolCall.canvas),
        compressed,
        evidence: buildEvidenceSummary(toolCall, evidence),
        reply: answer,
        usage: turn.usage,
      };
    }

    try {
      if (action === "grafana_prometheus_query") {
        onStatus?.("Running an instant Prometheus query");
        const result = await grafanaPrometheusQuery({
          query: toolCall.query,
          time: toolCall.time,
        });
        const query = getString(toolCall.query);
        evidence.queries.add(query);
        evidence.queryResults.push({ action, query, result });
        onStatus?.("Inspecting instant query results");
        prompt = buildCodexGrafanaResultPrompt(conversationContext, toolCall, result);
        continue;
      }

      if (action === "grafana_prometheus_query_range") {
        onStatus?.("Running a Prometheus range query for time-series evidence");
        const result = await grafanaPrometheusQueryRange({
          query: toolCall.query,
          start: toolCall.start,
          end: toolCall.end,
          step: toolCall.step,
        });
        const query = getString(toolCall.query);
        evidence.queries.add(query);
        evidence.queryResults.push({ action, query, result });
        onStatus?.("Inspecting returned time series and samples");
        prompt = buildCodexGrafanaResultPrompt(conversationContext, toolCall, result);
        continue;
      }

      if (action === "grafana_prometheus_label_values") {
        onStatus?.("Discovering available metric or label values");
        const result = await grafanaPrometheusLabelValues({
          label: toolCall.label,
          match: toolCall.match,
          start: toolCall.start,
          end: toolCall.end,
        });
        evidence.queryResults.push({ action, label: getString(toolCall.label), match: getString(toolCall.match), result });
        onStatus?.("Using discovery results to choose the next query");
        prompt = buildCodexGrafanaResultPrompt(conversationContext, toolCall, result);
        continue;
      }

      if (action === "grafana_prometheus_series") {
        onStatus?.("Discovering matching Prometheus series and labels");
        const result = await grafanaPrometheusSeries({
          match: toolCall.match,
          start: toolCall.start,
          end: toolCall.end,
        });
        evidence.queryResults.push({ action, match: getString(toolCall.match), result });
        onStatus?.("Using discovered series to choose the next query");
        prompt = buildCodexGrafanaResultPrompt(conversationContext, toolCall, result);
        continue;
      }
    } catch (error) {
      onStatus?.("Repairing a rejected PromQL query");
      prompt = buildCodexGrafanaErrorPrompt(conversationContext, toolCall, error);
      continue;
    }

    return {
      canvas: [],
      compressed,
      evidence: {
        nextChecks: [],
        observations: [],
        queries: evidence.queryResults.map((queryResult) => ({
          action: queryResult.action,
          label: queryResult.label,
          match: queryResult.match,
          query: queryResult.query,
          ...summarizePrometheusResult(queryResult.result),
        })),
        unknowns: [],
      } satisfies EvidenceSummary,
      reply: turn.finalResponse || "Codex returned an unsupported Grafana tool action.",
      usage: turn.usage,
    };
  }

  throw new Error("Codex requested too many Grafana tool calls");
}

export async function handleChat(request: Request) {
  const body = await parseJson<ChatRequest>(request);
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (!message) {
    return json({ error: "Message is required" }, { status: 400 });
  }

  const status = await codexLoginStatus();

  if (!status.authenticated) {
    return json({ error: "Codex is not authenticated", status }, { status: 401 });
  }

  try {
    const turn = await runCodexWithGrafanaTools(message);
    conversationHistory.push(
      { role: "user", text: message },
      { role: "assistant", text: turn.reply || "Codex completed the turn without a final message." },
    );

    return json({
      reply: turn.reply || "Codex completed the turn without a final message.",
      canvas: turn.canvas,
      compressed: turn.compressed,
      evidence: turn.evidence,
      memory: chatMemoryStatus(),
      threadId: codexThread?.id,
      usage: turn.usage,
    });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Codex request failed",
      },
      { status: 500 },
    );
  }
}

async function processChatMessage(message: string, onStatus?: ChatStatus) {
  onStatus?.("Checking Codex authentication");
  const status = await codexLoginStatus();

  if (!status.authenticated) {
    throw new Error("Codex is not authenticated");
  }

  const turn = await runCodexWithGrafanaTools(message, onStatus);
  conversationHistory.push(
    { role: "user", text: message },
    { role: "assistant", text: turn.reply || "Codex completed the turn without a final message." },
  );

  return {
    reply: turn.reply || "Codex completed the turn without a final message.",
    canvas: turn.canvas,
    compressed: turn.compressed,
    evidence: turn.evidence,
    memory: chatMemoryStatus(),
    threadId: codexThread?.id,
    usage: turn.usage,
  };
}

export async function handleChatStream(request: Request) {
  const body = await parseJson<ChatRequest>(request);
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (!message) {
    return json({ error: "Message is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const send = (event: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };

        try {
          const result = await processChatMessage(message, (status) => send({ type: "status", status }));
          send({ type: "result", ...result });
        } catch (error) {
          send({ type: "error", error: error instanceof Error ? error.message : "Codex request failed" });
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        "cache-control": "no-cache",
        "content-type": "application/x-ndjson",
      },
    },
  );
}

export function chatMemoryStatus() {
  const estimatedTokens = estimateConversationTokens();

  return {
    compressedSummary: Boolean(conversationSummary),
    compressionThresholdRatio,
    contextLimitTokens,
    estimatedTokens,
    retainedHistoryEntries,
    shouldCompress: shouldCompressConversation(),
  };
}

export function resetChatMemory() {
  conversationSummary = "";
  conversationHistory = [];
  codexThread = null;

  return chatMemoryStatus();
}
