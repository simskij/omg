import { join, normalize } from "node:path";
import { Codex, type Thread } from "@openai/codex-sdk";

const port = Number(Bun.env.PORT ?? 3000);
const clientDist = normalize(Bun.env.CLIENT_DIST ?? join(import.meta.dir, "../../dist/client"));
const codex = new Codex();
let codexThread: Thread | null = null;
let authProcess: ReturnType<typeof Bun.spawn> | null = null;
let authChallenge: AuthChallenge | null = null;
let authOutput = "";

type AuthChallenge = {
  verificationUri: string;
  userCode: string;
  expiresInMinutes: number;
  startedAt: string;
};

type ChatRequest = {
  message?: unknown;
};

type PrometheusQueryRequest = {
  query?: unknown;
  label?: unknown;
  match?: unknown;
  time?: unknown;
  start?: unknown;
  end?: unknown;
  step?: unknown;
};

type CodexGrafanaToolCall = {
  action?: unknown;
  answer?: unknown;
  canvas?: unknown;
  query?: unknown;
  label?: unknown;
  match?: unknown;
  time?: unknown;
  start?: unknown;
  end?: unknown;
  step?: unknown;
  reason?: unknown;
};

const codexGrafanaSchema = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "answer",
        "grafana_prometheus_query",
        "grafana_prometheus_query_range",
        "grafana_prometheus_label_values",
        "grafana_prometheus_series",
      ],
    },
    answer: { type: ["string", "null"] },
    canvas: { type: ["string", "null"] },
    query: { type: ["string", "null"] },
    label: { type: ["string", "null"] },
    match: { type: ["string", "null"] },
    time: { type: ["string", "null"] },
    start: { type: ["string", "null"] },
    end: { type: ["string", "null"] },
    step: { type: ["string", "null"] },
    reason: { type: ["string", "null"] },
  },
  required: ["action", "answer", "canvas", "query", "label", "match", "time", "start", "end", "step", "reason"],
  additionalProperties: false,
} as const;

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

async function serveStatic(pathname: string) {
  const normalizedPath = normalize(pathname === "/" ? "/index.html" : pathname);

  if (normalizedPath.startsWith("..")) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = join(clientDist, normalizedPath);
  const file = Bun.file(filePath);

  if (await file.exists()) {
    return new Response(file);
  }

  const index = Bun.file(join(clientDist, "index.html"));

  if (await index.exists()) {
    return new Response(index);
  }

  return new Response("Client build not found. Run `bun run build` first.", { status: 404 });
}

async function parseJson<T>(request: Request) {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

async function readStream(stream: ReadableStream<Uint8Array> | null, onChunk: (chunk: string) => void) {
  if (!stream) {
    return;
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    onChunk(decoder.decode(value, { stream: true }));
  }
}

function stripAnsi(value: string) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function readablePipe(pipe: number | ReadableStream<Uint8Array> | undefined) {
  return typeof pipe === "number" || !pipe ? null : pipe;
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function grafanaConfig() {
  const baseUrl = getString(Bun.env.GRAFANA_PROMETHEUS_URL);
  const token = getString(Bun.env.GRAFANA_PROMETHEUS_TOKEN ?? Bun.env.GRAFANA_CLOUD_ACCESS_TOKEN);
  const user = getString(Bun.env.GRAFANA_PROMETHEUS_USER ?? Bun.env.GRAFANA_CLOUD_INSTANCE_ID);

  if (!baseUrl) {
    throw new Error("GRAFANA_PROMETHEUS_URL is required");
  }

  if (!token) {
    throw new Error("GRAFANA_PROMETHEUS_TOKEN is required");
  }

  return { baseUrl, token, user };
}

function prometheusApiUrl(pathname: string) {
  const { baseUrl } = grafanaConfig();
  const base = new URL(baseUrl);
  const basePath = base.pathname
    .replace(/\/+$/, "")
    .replace(/\/api\/v1\/(query|query_range)$/, "/api/v1");
  const apiBasePath = basePath.endsWith("/api/v1") ? basePath : `${basePath}/api/v1`;

  base.pathname = `${apiBasePath}${pathname}`.replace(/\/+/g, "/");
  base.search = "";

  return base;
}

function grafanaAuthHeaders() {
  const { token, user } = grafanaConfig();

  if (user) {
    return {
      authorization: `Basic ${btoa(`${user}:${token}`)}`,
    };
  }

  return {
    authorization: `Bearer ${token}`,
  };
}

async function grafanaPrometheusRequest(pathname: string, params: Record<string, string>) {
  const url = prometheusApiUrl(pathname);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: grafanaAuthHeaders(),
  });
  const body = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const bodyText = JSON.stringify(body);
    const authHint =
      response.status === 401
        ? " Grafana Cloud Prometheus requires basic auth with the metrics instance ID as GRAFANA_PROMETHEUS_USER and an access policy token with metrics:read as GRAFANA_PROMETHEUS_TOKEN. Grafana UI service-account tokens will not work for this endpoint."
        : "";

    throw new Error(
      `Grafana Prometheus returned ${response.status} for ${url.origin}${url.pathname}: ${bodyText}.${authHint}`,
    );
  }

  return body;
}

async function grafanaPrometheusSeries(request: PrometheusQueryRequest) {
  const match = getString(request.match);

  if (!match) {
    throw new Error("Prometheus series lookup requires match");
  }

  return grafanaPrometheusRequest("/series", {
    "match[]": match,
    start: getString(request.start),
    end: getString(request.end),
  });
}

async function grafanaPrometheusLabelValues(request: PrometheusQueryRequest) {
  const label = getString(request.label);
  const match = getString(request.match);

  if (!label) {
    throw new Error("Prometheus label values lookup requires label");
  }

  return grafanaPrometheusRequest(`/label/${encodeURIComponent(label)}/values`, {
    "match[]": match,
    start: getString(request.start),
    end: getString(request.end),
  });
}

async function grafanaPrometheusQuery(request: PrometheusQueryRequest) {
  const query = getString(request.query);

  if (!query) {
    throw new Error("Prometheus query is required");
  }

  return grafanaPrometheusRequest("/query", {
    query,
    time: getString(request.time),
  });
}

async function grafanaPrometheusQueryRange(request: PrometheusQueryRequest) {
  const query = getString(request.query);
  const start = getString(request.start);
  const end = getString(request.end);
  const step = getString(request.step);

  if (!query || !start || !end || !step) {
    throw new Error("Prometheus range query requires query, start, end, and step");
  }

  return grafanaPrometheusRequest("/query_range", { query, start, end, step });
}

async function handlePrometheusQuery(request: Request) {
  const body = await parseJson<PrometheusQueryRequest>(request);

  if (!body) {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    return json(await grafanaPrometheusQuery(body));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Prometheus query failed" }, { status: 500 });
  }
}

async function handlePrometheusQueryRange(request: Request) {
  const body = await parseJson<PrometheusQueryRequest>(request);

  if (!body) {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    return json(await grafanaPrometheusQueryRange(body));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Prometheus range query failed" }, { status: 500 });
  }
}

async function handlePrometheusSeries(request: Request) {
  const body = await parseJson<PrometheusQueryRequest>(request);

  if (!body) {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    return json(await grafanaPrometheusSeries(body));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Prometheus series lookup failed" }, { status: 500 });
  }
}

async function handlePrometheusLabelValues(request: Request) {
  const body = await parseJson<PrometheusQueryRequest>(request);

  if (!body) {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    return json(await grafanaPrometheusLabelValues(body));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Prometheus label values lookup failed" }, { status: 500 });
  }
}

function parseCodexToolCall(value: string) {
  try {
    return JSON.parse(value) as CodexGrafanaToolCall;
  } catch {
    return { action: "answer", answer: value } satisfies CodexGrafanaToolCall;
  }
}

function parseCanvasInstructions(value: unknown) {
  const canvas = getString(value);

  if (!canvas) {
    return [];
  }

  try {
    const parsed = JSON.parse(canvas) as unknown;

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildCodexGrafanaPrompt(message: string) {
  return `You are connected to a Bun backend that can query Grafana Cloud metrics through the Prometheus HTTP API.

If the user asks for metrics, measurements, time series, PromQL, service health, latency, errors, traffic, saturation, or anything that needs Grafana Cloud data, return a JSON object requesting one tool call.

When you have enough information to answer, you may also instruct the frontend canvas to render visuals. Put those instructions in the "canvas" field as a JSON-encoded array string. Supported canvas items:
- {"type":"single_stat","label":"<title>","dataType":"numeric","value":123}
- {"type":"single_stat","label":"<title>","dataType":"percentage","value":99.9}
- {"type":"single_stat","label":"<title>","dataType":"bool","value":true}
- {"type":"graph","title":"<title>","categories":["10:00","10:01"],"series":[{"name":"<series name>","data":[1,2]}]}
- {"type":"heatmap","title":"<title>","columns":["alert-a","alert-b"],"rows":[{"label":"host-1","values":["ok","warning"]},{"label":"host-2","values":["critical","ok"]}]}

Every canvas item should include a "query" string containing the PromQL query that produced the rendered value when it came from Prometheus data. Omit query only for values that did not come from PromQL.

Only render values that are present in tool results or directly requested by the user. Do not invent datapoints.

For questions about multiple hosts, nodes, machines, instances, or servers, prefer a canvas that combines aggregate and per-node views:
- Include aggregate single stats when useful, for example total host count, unhealthy host count, average CPU, average memory, or alert count.
- Include individual host data, not only fleet averages. Use graph series per host, or separate graph items when different resource classes are clearer.
- For "how are my hosts doing" style questions, use your judgement but generally surface CPU utilization, memory utilization, disk utilization, host up/down state, and host-applicable alerts.
- Render host-applicable alerts as a heatmap when alert state data is available. Use rows for hosts and columns for alert names or alert groups. Values should be "ok", "warning", "critical", or "unknown".
- In prose, summarize the conclusion and call out the worst hosts or highest-risk signals first.
- Avoid hiding outliers behind only aggregate statistics.

For host CPU, memory, and disk questions, do not assume metric names. If a standard node-exporter query returns empty, discover names before answering:
- Use grafana_prometheus_label_values with label "__name__" and match selectors such as {__name__=~".*(cpu|load|memory|mem|disk|filesystem|fs|node|host).*"} over a recent time window.
- Use grafana_prometheus_series with narrow matches to inspect labels for candidate metrics.
- Common metric families include node_cpu_seconds_total, node_memory_MemAvailable_bytes, node_memory_MemTotal_bytes, node_filesystem_avail_bytes, node_filesystem_size_bytes, windows_cpu_time_total, windows_logical_disk_free_bytes, and custom recording rules.
- Do not tell the user metrics are unavailable until you have tried discovery and at least one candidate query from discovered names.

Available actions:
- {"action":"grafana_prometheus_query_range","answer":null,"canvas":null,"query":"<PromQL>","label":null,"match":null,"time":null,"start":"<RFC3339 or unix timestamp>","end":"<RFC3339 or unix timestamp>","step":"<duration or seconds>","reason":"<why this query is needed>"}
- {"action":"grafana_prometheus_query","answer":null,"canvas":null,"query":"<PromQL>","label":null,"match":null,"time":"<optional RFC3339 or unix timestamp>","start":null,"end":null,"step":null,"reason":"<why this query is needed>"}
- {"action":"grafana_prometheus_label_values","answer":null,"canvas":null,"query":null,"label":"<label name>","match":"<optional series selector>","time":null,"start":"<optional RFC3339 or unix timestamp>","end":"<optional RFC3339 or unix timestamp>","step":null,"reason":"<why this lookup is needed>"}
- {"action":"grafana_prometheus_series","answer":null,"canvas":null,"query":null,"label":null,"match":"<series selector, e.g. up or {__name__=\"up\"}>","time":null,"start":"<optional RFC3339 or unix timestamp>","end":"<optional RFC3339 or unix timestamp>","step":null,"reason":"<why this lookup is needed>"}
- {"action":"answer","answer":"<final user-facing answer>","canvas":"<JSON-encoded canvas instruction array or null>","query":null,"label":null,"match":null,"time":null,"start":null,"end":null,"step":null,"reason":null}

Use only PromQL that is safe to read. Do not invent metric values. If you need metric names, use grafana_prometheus_label_values for __name__ or grafana_prometheus_series with a narrow match.

Range vs instant query rules:
- Use grafana_prometheus_query_range whenever the user asks for graphs, diagrams, panels, time series, trends, recent behavior, utilization, host health, or anything "over time".
- Use grafana_prometheus_query only for single-stat snapshots, current values, counts, booleans, or quick scalar/vector checks.
- Every canvas item with type "graph" should be based on a grafana_prometheus_query_range result unless the user explicitly asks for a single point in time.
- Do not render graph canvas items from instant query results. If you have an instant result but need a graph, use it only for single stats and request a follow-up grafana_prometheus_query_range.
- For CPU, memory, and disk utilization, use range queries for graph panels and optionally instant queries for aggregate single stats.

Default time windows:
- If the user does not specify a range for host/resource utilization, use the last 1 hour with step "60s".
- For broad "how are things doing" or recent-history questions, use the last 1 hour by default.
- Use the last 6 hours only when the user asks for wider recent history, today-ish behavior, recurring issues, or slow-moving signals.
- Use RFC3339 timestamps for start and end. Use the current time as end when the user does not specify one.

Range result to graph mapping:
- For Prometheus matrix results, use sample timestamps as graph categories, formatted compactly if needed.
- Use each series' host, instance, device, mountpoint, or other distinguishing labels as series[].name.
- Use the numeric sample values as series[].data.
- Preserve units in titles or prose when known, for example CPU %, memory %, disk %.

PromQL correctness rules:
- Range selectors like [5m] are only allowed directly on vector selectors, for example rate(http_requests_total[5m]) is valid, but (sum(http_requests_total))[5m] is invalid.
- To apply a lookback to an expression, use a subquery with a resolution, for example avg_over_time((sum(rate(http_requests_total[5m])))[30m:1m]).
- If Prometheus returns a parse error, repair the query and try again before answering.

Important for availability questions: do not use raw instant query "up" as the first attempt. Prefer a recent lookback query such as max_over_time(up[5m]) or use grafana_prometheus_series with match "up" to confirm labels over a time window. A raw instant query can be empty even when recent or historical up series exist.

User message:
${message}`;
}

function toolResultKind(action: string) {
  if (action === "grafana_prometheus_query_range") {
    return "range query result: Prometheus matrix data suitable for graph canvas items";
  }

  if (action === "grafana_prometheus_query") {
    return "instant query result: Prometheus vector/scalar data suitable for single-stat snapshots, not graph canvas items";
  }

  if (action === "grafana_prometheus_label_values" || action === "grafana_prometheus_series") {
    return "discovery result: use this to choose follow-up PromQL, not as final metric data unless the user asked for discovery";
  }

  return "unknown tool result";
}

function buildCodexGrafanaResultPrompt(userMessage: string, toolCall: CodexGrafanaToolCall, result: unknown) {
  const action = getString(toolCall.action);

  return `Grafana Cloud Prometheus returned this JSON for your requested tool call.

Original user message:
${userMessage}

Result type:
${toolResultKind(action)}

Tool call:
${JSON.stringify(toolCall, null, 2)}

Result:
${JSON.stringify(result, null, 2)}

You may either request another Grafana tool call or provide the final answer.

If the result is empty or insufficient, do not stop early. Request a follow-up discovery or candidate query. For CPU, memory, disk, filesystem, or host questions, discover metric names with label_values __name__ and/or series before concluding data is unavailable.

If this is an instant query result and the user asked for graphs, time series, trends, utilization history, or host health panels, request a follow-up grafana_prometheus_query_range before answering. Use the instant result only for single-stat snapshots.

If this is a range query result and it contains matrix data, prefer producing graph canvas instructions when the user asked for diagrams, panels, trends, utilization, or host health. Map matrix sample timestamps to categories and sample values to series[].data.

Available follow-up actions use the same JSON shape as before:
- grafana_prometheus_query
- grafana_prometheus_query_range
- grafana_prometheus_label_values
- grafana_prometheus_series
- answer

When ready, return a JSON object with {"action":"answer","answer":"<concise user-facing interpretation>","canvas":"<JSON-encoded canvas instruction array or null>","query":null,"label":null,"match":null,"time":null,"start":null,"end":null,"step":null,"reason":null}. Include the PromQL query you used when useful. Do not claim data that is not present in the result. If the result is suitable for visualization, include canvas instructions for single stats, graphs, or heatmaps. For multi-host answers, include both aggregate and individual views when possible.`;
}

function buildCodexGrafanaErrorPrompt(userMessage: string, toolCall: CodexGrafanaToolCall, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return `Grafana Cloud Prometheus rejected your requested tool call.

Original user message:
${userMessage}

Tool call:
${JSON.stringify(toolCall, null, 2)}

Error:
${message}

Repair the query or request a discovery call, then return another Grafana tool call using the same JSON schema. Do not answer with failure until you have tried a corrected query. If the error says "ranges only allowed for vector selectors", move the range selector directly onto the metric selector, or use a PromQL subquery like (<expression>)[30m:1m] before passing it to *_over_time.`;
}

function parseAuthChallenge(output: string): AuthChallenge | null {
  const cleanOutput = stripAnsi(output);
  const uri = cleanOutput.match(/https:\/\/auth\.openai\.com\/codex\/device/)?.[0];
  const code = cleanOutput.match(/\b[A-Z0-9]{4}-[A-Z0-9]{5,8}\b/)?.[0];

  if (!uri || !code) {
    return null;
  }

  return {
    verificationUri: uri,
    userCode: code,
    expiresInMinutes: 15,
    startedAt: new Date().toISOString(),
  };
}

async function codexLoginStatus() {
  const process = Bun.spawn(["bunx", "codex", "login", "status"], {
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  const output = `${stdout}\n${stderr}`.trim();

  return {
    authenticated: exitCode === 0 && !/not logged in/i.test(output),
    details: output || "Unknown Codex auth status",
  };
}

async function startCodexDeviceAuth() {
  if (authChallenge && authProcess && !authProcess.killed) {
    return authChallenge;
  }

  authChallenge = null;
  authOutput = "";
  authProcess = Bun.spawn(["bunx", "codex", "login", "--device-auth"], {
    stderr: "pipe",
    stdout: "pipe",
  });

  void readStream(readablePipe(authProcess.stdout), (chunk) => {
    authOutput += chunk;
    authChallenge = authChallenge ?? parseAuthChallenge(authOutput);
  });
  void readStream(readablePipe(authProcess.stderr), (chunk) => {
    authOutput += chunk;
    authChallenge = authChallenge ?? parseAuthChallenge(authOutput);
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (authChallenge) {
      return authChallenge;
    }

    await Bun.sleep(100);
  }

  throw new Error(
    authOutput
      ? `Codex did not return a device auth challenge. Output: ${stripAnsi(authOutput).trim()}`
      : "Codex did not return a device auth challenge",
  );
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

async function runCodexWithGrafanaTools(message: string) {
  const thread = getCodexThread();
  let prompt = buildCodexGrafanaPrompt(message);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const turn = await thread.run(prompt, { outputSchema: codexGrafanaSchema });
    const toolCall = parseCodexToolCall(turn.finalResponse);
    const action = getString(toolCall.action);

    if (action === "answer") {
      const answer = getString(toolCall.answer) || turn.finalResponse;

      return {
        canvas: parseCanvasInstructions(toolCall.canvas),
        reply: answer,
        usage: turn.usage,
      };
    }

    try {
      if (action === "grafana_prometheus_query") {
        const result = await grafanaPrometheusQuery({
          query: toolCall.query,
          time: toolCall.time,
        });
        prompt = buildCodexGrafanaResultPrompt(message, toolCall, result);
        continue;
      }

      if (action === "grafana_prometheus_query_range") {
        const result = await grafanaPrometheusQueryRange({
          query: toolCall.query,
          start: toolCall.start,
          end: toolCall.end,
          step: toolCall.step,
        });
        prompt = buildCodexGrafanaResultPrompt(message, toolCall, result);
        continue;
      }

      if (action === "grafana_prometheus_label_values") {
        const result = await grafanaPrometheusLabelValues({
          label: toolCall.label,
          match: toolCall.match,
          start: toolCall.start,
          end: toolCall.end,
        });
        prompt = buildCodexGrafanaResultPrompt(message, toolCall, result);
        continue;
      }

      if (action === "grafana_prometheus_series") {
        const result = await grafanaPrometheusSeries({
          match: toolCall.match,
          start: toolCall.start,
          end: toolCall.end,
        });
        prompt = buildCodexGrafanaResultPrompt(message, toolCall, result);
        continue;
      }
    } catch (error) {
      prompt = buildCodexGrafanaErrorPrompt(message, toolCall, error);
      continue;
    }

    return {
      canvas: [],
      reply: turn.finalResponse || "Codex returned an unsupported Grafana tool action.",
      usage: turn.usage,
    };
  }

  throw new Error("Codex requested too many Grafana tool calls");
}

async function handleChat(request: Request) {
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

    return json({
      reply: turn.reply || "Codex completed the turn without a final message.",
      canvas: turn.canvas,
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

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        status: "ok",
        runtime: "bun",
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/codex/auth/status") {
      return json(await codexLoginStatus());
    }

    if (url.pathname === "/api/codex/auth/start" && request.method === "POST") {
      try {
        return json({ challenge: await startCodexDeviceAuth() });
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : "Unable to start Codex device auth" },
          { status: 500 },
        );
      }
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChat(request);
    }

    if (url.pathname === "/api/grafana/prometheus/query" && request.method === "POST") {
      return handlePrometheusQuery(request);
    }

    if (url.pathname === "/api/grafana/prometheus/query_range" && request.method === "POST") {
      return handlePrometheusQueryRange(request);
    }

    if (url.pathname === "/api/grafana/prometheus/series" && request.method === "POST") {
      return handlePrometheusSeries(request);
    }

    if (url.pathname === "/api/grafana/prometheus/label_values" && request.method === "POST") {
      return handlePrometheusLabelValues(request);
    }

    if (request.method === "GET" || request.method === "HEAD") {
      return serveStatic(url.pathname);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Server listening on http://localhost:${port}`);
