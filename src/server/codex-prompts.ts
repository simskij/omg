import type { CodexGrafanaToolCall, EvidenceSummary, TurnEvidence } from "./types";
import { getObservations, getString, getStringArray, truncateForPrompt } from "./utils";

export const codexGrafanaSchema = {
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
    interpretation: {
      type: ["array", "null"],
      items: { type: "string" },
    },
    nextChecks: {
      type: ["array", "null"],
      items: { type: "string" },
    },
    observations: {
      type: ["array", "null"],
      items: {
        type: "object",
        properties: {
          confidence: { type: "string", enum: ["computed", "inferred", "observed", "unknown"] },
          evidence: {
            type: ["object", "null"],
            properties: {
              query: { type: ["string", "null"] },
              source: { type: ["string", "null"], enum: ["prometheus", "user", "memory", "none", null] },
            },
            required: ["query", "source"],
            additionalProperties: false,
          },
          text: { type: "string" },
        },
        required: ["confidence", "evidence", "text"],
        additionalProperties: false,
      },
    },
    query: { type: ["string", "null"] },
    label: { type: ["string", "null"] },
    match: { type: ["string", "null"] },
    unknowns: {
      type: ["array", "null"],
      items: { type: "string" },
    },
    time: { type: ["string", "null"] },
    start: { type: ["string", "null"] },
    end: { type: ["string", "null"] },
    step: { type: ["string", "null"] },
    reason: { type: ["string", "null"] },
  },
  required: [
    "action",
    "answer",
    "canvas",
    "interpretation",
    "nextChecks",
    "observations",
    "query",
    "label",
    "match",
    "unknowns",
    "time",
    "start",
    "end",
    "step",
    "reason",
  ],
  additionalProperties: false,
} as const;

export function parseCodexToolCall(value: string) {
  try {
    return JSON.parse(value) as CodexGrafanaToolCall;
  } catch {
    return { action: "answer", answer: value } satisfies CodexGrafanaToolCall;
  }
}

export function parseCanvasInstructions(value: unknown) {
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

function canvasQueries(canvas: unknown[]) {
  return canvas.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const query = getString((item as { query?: unknown }).query);

    return query ? [query] : [];
  });
}

export function validateFactualAnswer(toolCall: CodexGrafanaToolCall, evidence: TurnEvidence) {
  const issues: string[] = [];
  const observations = getObservations(toolCall.observations);
  const interpretation = getStringArray(toolCall.interpretation);
  const answer = getString(toolCall.answer);
  const canvas = parseCanvasInstructions(toolCall.canvas);
  const bannedCertainty = /\b(caused by|root cause is|definitely|clearly)\b/i;

  if (observations.length === 0 && getStringArray(toolCall.unknowns).length === 0) {
    issues.push("Answer must contain at least one supported observation or explicit unknown.");
  }

  for (const observation of observations) {
    if (bannedCertainty.test(observation.text)) {
      issues.push(`Observation uses overconfident/root-cause language: ${observation.text}`);
    }

    if (observation.evidence?.source === "prometheus") {
      if (!observation.evidence.query) {
        issues.push(`Prometheus observation is missing evidence.query: ${observation.text}`);
      } else if (!evidence.queries.has(observation.evidence.query)) {
        issues.push(`Observation cites a PromQL query that was not executed: ${observation.evidence.query}`);
      }
    }

    if ((observation.confidence === "observed" || observation.confidence === "computed") && observation.evidence?.source === "none") {
      issues.push(`Observed/computed observation cannot use source=none: ${observation.text}`);
    }
  }

  for (const text of [answer, ...interpretation]) {
    if (bannedCertainty.test(text)) {
      issues.push(`Answer or interpretation uses overconfident/root-cause language: ${text}`);
    }
  }

  for (const query of canvasQueries(canvas)) {
    if (!evidence.queries.has(query)) {
      issues.push(`Canvas cites a PromQL query that was not executed: ${query}`);
    }
  }

  return issues;
}

export function renderFactualAnswer(toolCall: CodexGrafanaToolCall) {
  const conclusion = getString(toolCall.answer);
  const observations = getObservations(toolCall.observations);
  const interpretation = getStringArray(toolCall.interpretation);
  const unknowns = getStringArray(toolCall.unknowns);
  const nextChecks = getStringArray(toolCall.nextChecks);
  const sections: string[] = [];

  if (conclusion) {
    sections.push(conclusion);
  }

  const summaryItems = interpretation.length > 0 ? interpretation : observations.slice(0, 3).map((observation) => observation.text);

  if (summaryItems.length > 0) {
    sections.push([`Summary`, ...summaryItems.slice(0, 3).map((item) => `- ${item}`)].join("\n"));
  }

  if (unknowns.length > 0) {
    sections.push(
      unknowns.length === 1
        ? `Caveat: ${unknowns[0]}`
        : `Caveats: ${unknowns.length} unknowns or data limitations are captured in the evidence view.`,
    );
  }

  sections.push(`Evidence: ${observations.length} observations, ${unknowns.length} unknowns, ${nextChecks.length} suggested next checks.`);

  return sections.join("\n\n") || "I do not have enough supported evidence to answer that yet.";
}

export function buildFactualRepairPrompt(userMessage: string, toolCall: CodexGrafanaToolCall, evidence: TurnEvidence, issues: string[]) {
  return `Your previous observability answer failed factuality validation. Repair it by removing unsupported claims, lowering confidence, adding unknowns, or requesting another Grafana tool call if more evidence is needed.

Original user message and conversation context:
${userMessage}

Validation issues:
${issues.map((issue) => `- ${issue}`).join("\n")}

Executed evidence for this turn:
${truncateForPrompt(evidence.queryResults)}

Previous answer object:
${truncateForPrompt(toolCall)}

Return either another Grafana tool call or a corrected answer object. Keep observations factual and cite only executed PromQL queries.`;
}

function prometheusData(result: unknown) {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  return (result as { data?: unknown }).data;
}

export function summarizePrometheusResult(result: unknown) {
  const data = prometheusData(result);

  if (Array.isArray(data)) {
    return { empty: data.length === 0, sampleCount: data.length, seriesCount: data.length };
  }

  if (!data || typeof data !== "object") {
    return { empty: true, sampleCount: 0, seriesCount: 0 };
  }

  const resultData = (data as { result?: unknown; resultType?: unknown }).result;

  if (!Array.isArray(resultData)) {
    return { empty: !resultData, sampleCount: resultData ? 1 : 0, seriesCount: resultData ? 1 : 0 };
  }

  const sampleCount = resultData.reduce((count, series) => {
    if (!series || typeof series !== "object") {
      return count;
    }

    const candidate = series as { value?: unknown; values?: unknown };

    if (Array.isArray(candidate.values)) {
      return count + candidate.values.length;
    }

    if (Array.isArray(candidate.value)) {
      return count + 1;
    }

    return count;
  }, 0);

  return { empty: resultData.length === 0 || sampleCount === 0, sampleCount, seriesCount: resultData.length };
}

export function buildEvidenceSummary(toolCall: CodexGrafanaToolCall, evidence: TurnEvidence): EvidenceSummary {
  return {
    nextChecks: getStringArray(toolCall.nextChecks),
    observations: getObservations(toolCall.observations),
    queries: evidence.queryResults.map((queryResult) => ({
      action: queryResult.action,
      label: queryResult.label,
      match: queryResult.match,
      query: queryResult.query,
      ...summarizePrometheusResult(queryResult.result),
    })),
    unknowns: getStringArray(toolCall.unknowns),
  };
}

export function buildCodexGrafanaPrompt(message: string) {
  return `You are connected to a Bun backend that can query Grafana Cloud metrics through the Prometheus HTTP API.

If the user asks for metrics, measurements, time series, PromQL, service health, latency, errors, traffic, saturation, or anything that needs Grafana Cloud data, return a JSON object requesting one tool call.

Strict observability factuality contract:
- Do not make unsupported factual claims. Every observation must be directly observed, computed from observed data, explicitly supplied by the user, or carried in memory.
- Prefer saying data is missing or unknown over guessing.
- Never infer root cause from correlation alone. Do not say "caused by", "root cause is", "definitely", or "clearly" unless the evidence directly proves it.
- Use "correlates with", "coincides with", "is consistent with", or "needs verification" for weak evidence.
- Do not mention metrics, services, labels, hosts, alerts, regions, namespaces, devices, mountpoints, or values unless they appear in user input, memory, or tool results.
- Distinguish empty result from zero: an empty vector means no matching/current series or missing data, not an observed zero. A numeric 0 means observed zero. Missing datapoints mean incomplete data.
- If a standard query returns empty, try metric discovery before saying data is unavailable.
- Keep observations separate from interpretation. Observations must be factual; interpretation may be cautious but must not overstate certainty.

When action is "answer", return structured fields:
- observations: array of {"text":"<factual claim>","confidence":"observed|computed|inferred|unknown","evidence":{"source":"prometheus|user|memory|none","query":"<PromQL or null>"}}
- interpretation: cautious explanatory bullets. Do not introduce new facts here.
- unknowns: missing data, unavailable labels, empty query caveats, or limits of the evidence.
- nextChecks: concrete follow-up checks or queries.
- answer: optional short conclusion only; the server will render the final response from the structured fields.

For every observation based on Prometheus data, include the exact query in evidence.query. If no query or source supports a claim, put it in unknowns or nextChecks instead of observations.

When you have enough information to answer, you may also instruct the frontend canvas to render visuals. Put those instructions in the "canvas" field as a JSON-encoded array string. Supported canvas items:
- {"type":"single_stat","label":"<title>","dataType":"numeric","value":123}
- {"type":"single_stat","label":"<title>","dataType":"percentage","value":99.9}
- {"type":"single_stat","label":"<title>","dataType":"bool","value":true}
- {"type":"graph","title":"<title>","categories":["10:00","10:01"],"series":[{"name":"<series name>","data":[1,2]}]}
- {"type":"stacked_timeseries","title":"<title>","categories":["10:00","10:01"],"series":[{"name":"<series name>","data":[1,2]}]}
- {"type":"bar","title":"<title>","categories":["host-a","host-b"],"series":[{"name":"cpu %","data":[54,82]}]}
- {"type":"gauge","title":"<title>","value":82,"min":0,"max":100,"unit":"%","thresholds":{"warning":75,"critical":90}}
- {"type":"table","title":"<title>","columns":["host","value"],"rows":[["host-a",82],["host-b",54]]}
- {"type":"heatmap","title":"<title>","columns":["alert-a","alert-b"],"rows":[{"label":"host-1","values":["ok","warning"]},{"label":"host-2","values":["critical","ok"]}]}
- {"type":"alert_list","title":"<title>","alerts":[{"name":"HighCPU","severity":"warning","state":"firing","target":"host-a","summary":"CPU above threshold","startsAt":"2026-05-13T12:00:00Z"}]}
- {"type":"histogram","title":"<title>","buckets":[{"label":"0.1s","value":12},{"label":"0.5s","value":34}]}
- {"type":"event_timeline","title":"<title>","events":[{"time":"2026-05-13T12:00:00Z","title":"Deploy started","severity":"ok","description":"version abc123"}]}
- {"type":"markdown","title":"<optional title>","content":"Plain markdown-like text for notes, runbooks, or summaries."}

Visualization choice rules:
- Use single_stat for current scalar/vector snapshots, counts, percentages, and booleans.
- Use graph for one or more time series over time.
- Use stacked_timeseries when the parts add up to a useful total over time, such as traffic by status class or CPU mode composition.
- Use bar for categorical comparisons at one time or over an aggregate window, such as top hosts, services, routes, devices, or mountpoints.
- Use gauge for one saturation value with known min/max and optional thresholds, such as CPU %, memory %, disk %, queue saturation, or SLO burn.
- Use table for labeled Prometheus vectors, top-N results, inventory, discovery output, or any data where exact labels matter.
- Use heatmap for status matrices such as host by alert or host by resource health.
- Use alert_list for active alert triage when alert names, severity, state, target, summary, or start time matter.
- Use histogram for bucketed distributions such as latency buckets or request size buckets.
- Use event_timeline only when the data is actually event-like and includes timestamps.
- Use markdown for short supporting notes or runbook-style context, not as a replacement for metric panels.

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
- {"action":"grafana_prometheus_query_range","answer":null,"canvas":null,"interpretation":null,"nextChecks":null,"observations":null,"query":"<PromQL>","label":null,"match":null,"unknowns":null,"time":null,"start":"<RFC3339 or unix timestamp>","end":"<RFC3339 or unix timestamp>","step":"<duration or seconds>","reason":"<why this query is needed>"}
- {"action":"grafana_prometheus_query","answer":null,"canvas":null,"interpretation":null,"nextChecks":null,"observations":null,"query":"<PromQL>","label":null,"match":null,"unknowns":null,"time":"<optional RFC3339 or unix timestamp>","start":null,"end":null,"step":null,"reason":"<why this query is needed>"}
- {"action":"grafana_prometheus_label_values","answer":null,"canvas":null,"interpretation":null,"nextChecks":null,"observations":null,"query":null,"label":"<label name>","match":"<optional series selector>","unknowns":null,"time":null,"start":"<optional RFC3339 or unix timestamp>","end":"<optional RFC3339 or unix timestamp>","step":null,"reason":"<why this lookup is needed>"}
- {"action":"grafana_prometheus_series","answer":null,"canvas":null,"interpretation":null,"nextChecks":null,"observations":null,"query":null,"label":null,"match":"<series selector, e.g. up or {__name__=\"up\"}>","unknowns":null,"time":null,"start":"<optional RFC3339 or unix timestamp>","end":"<optional RFC3339 or unix timestamp>","step":null,"reason":"<why this lookup is needed>"}
- {"action":"answer","answer":"<short conclusion or null>","canvas":"<JSON-encoded canvas instruction array or null>","interpretation":["<cautious interpretation>"],"nextChecks":["<follow-up check>"],"observations":[{"text":"<claim>","confidence":"observed","evidence":{"source":"prometheus","query":"<PromQL>"}}],"query":null,"label":null,"match":null,"unknowns":["<missing data or caveat>"],"time":null,"start":null,"end":null,"step":null,"reason":null}

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

export function buildCodexGrafanaResultPrompt(userMessage: string, toolCall: CodexGrafanaToolCall, result: unknown) {
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

When ready, return a JSON object with {"action":"answer","answer":"<short conclusion or null>","canvas":"<JSON-encoded canvas instruction array or null>","interpretation":["<cautious interpretation>"],"nextChecks":["<follow-up check>"],"observations":[{"text":"<claim>","confidence":"observed|computed|inferred|unknown","evidence":{"source":"prometheus|user|memory|none","query":"<PromQL or null>"}}],"query":null,"label":null,"match":null,"unknowns":["<missing data or caveat>"],"time":null,"start":null,"end":null,"step":null,"reason":null}. Include the PromQL query for every Prometheus-backed observation. Do not claim data that is not present in the result. If the result is suitable for visualization, include canvas instructions. For multi-host answers, include both aggregate and individual views when possible.`;
}

export function buildCodexGrafanaErrorPrompt(userMessage: string, toolCall: CodexGrafanaToolCall, error: unknown) {
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
