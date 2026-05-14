export type HealthResponse = {
  status: string;
  runtime: string;
  timestamp: string;
};

export type CodexAuthStatus = {
  authenticated: boolean;
  details: string;
};

export type CodexAuthChallenge = {
  verificationUri: string;
  userCode: string;
  expiresInMinutes: number;
  startedAt: string;
};

export type ChatResponse = {
  canvas?: CanvasInstruction[];
  compressed?: boolean;
  evidence?: EvidenceSummary;
  reply?: string;
  error?: string;
  memory?: ChatMemoryStatus;
};

export type ChatStreamEvent =
  | ({ type: "result" } & Required<Pick<ChatResponse, "reply">> & Omit<ChatResponse, "error" | "reply">)
  | { error: string; type: "error" }
  | { status: string; type: "status" };

export type EvidenceSummary = {
  nextChecks: string[];
  observations: Array<{
    confidence: "computed" | "inferred" | "observed" | "unknown";
    evidence?: {
      query?: string;
      source?: "memory" | "none" | "prometheus" | "user";
    };
    text: string;
  }>;
  queries: Array<{
    action: string;
    empty: boolean;
    label?: string;
    match?: string;
    query?: string;
    sampleCount: number;
    seriesCount: number;
  }>;
  unknowns: string[];
};

export type ChatMemoryStatus = {
  compressedSummary: boolean;
  compressionThresholdRatio: number;
  contextLimitTokens: number;
  estimatedTokens: number;
  retainedHistoryEntries: number;
  shouldCompress: boolean;
};

export type SingleStatType = "numeric" | "percentage" | "bool";

export type SingleStatProps = {
  label: string;
  type: SingleStatType;
  value: number | boolean;
};

export type CanvasSingleStatInstruction = {
  type: "single_stat";
  label: string;
  dataType: SingleStatType;
  query?: string;
  value: number | boolean;
};

export type CanvasGraphInstruction = {
  type: "graph";
  title: string;
  categories?: string[];
  query?: string;
  series: Array<{
    name: string;
    data: number[];
  }>;
  unit?: string;
  yAxisTitle?: string;
};

export type CanvasStackedTimeseriesInstruction = {
  type: "stacked_timeseries";
  title: string;
  categories?: string[];
  query?: string;
  series: Array<{
    name: string;
    data: number[];
  }>;
  unit?: string;
  yAxisTitle?: string;
};

export type CanvasTableInstruction = {
  type: "table";
  title: string;
  columns: string[];
  query?: string;
  rows: Array<Array<string | number | boolean | null>>;
};

export type CanvasBarInstruction = {
  type: "bar";
  title: string;
  categories: string[];
  query?: string;
  series: Array<{
    name: string;
    data: number[];
  }>;
  unit?: string;
};

export type CanvasGaugeInstruction = {
  type: "gauge";
  title: string;
  label?: string;
  max?: number;
  min?: number;
  query?: string;
  thresholds?: {
    critical?: number;
    warning?: number;
  };
  unit?: string;
  value: number;
};

export type CanvasHeatmapInstruction = {
  type: "heatmap";
  title: string;
  columns: string[];
  query?: string;
  rows: Array<{
    label: string;
    values: Array<"ok" | "warning" | "critical" | "unknown">;
  }>;
};

export type CanvasAlertListInstruction = {
  type: "alert_list";
  title: string;
  alerts: Array<{
    name: string;
    severity?: "ok" | "warning" | "critical" | "unknown" | string;
    state?: string;
    target?: string;
    summary?: string;
    startsAt?: string;
  }>;
  query?: string;
};

export type CanvasHistogramInstruction = {
  type: "histogram";
  title: string;
  buckets: Array<{
    label: string;
    value: number;
  }>;
  query?: string;
  unit?: string;
};

export type CanvasEventTimelineInstruction = {
  type: "event_timeline";
  title: string;
  events: Array<{
    time: string;
    title: string;
    description?: string;
    severity?: "ok" | "warning" | "critical" | "unknown" | string;
  }>;
  query?: string;
};

export type CanvasMarkdownInstruction = {
  type: "markdown";
  title?: string;
  content: string;
};

export type CanvasInstruction =
  | CanvasSingleStatInstruction
  | CanvasGraphInstruction
  | CanvasStackedTimeseriesInstruction
  | CanvasTableInstruction
  | CanvasBarInstruction
  | CanvasGaugeInstruction
  | CanvasHeatmapInstruction
  | CanvasAlertListInstruction
  | CanvasHistogramInstruction
  | CanvasEventTimelineInstruction
  | CanvasMarkdownInstruction;

export type TimelineTone = "error" | "user";

export type TimelineEntry = {
  canvas?: CanvasInstruction[];
  evidence?: EvidenceSummary;
  id: string;
  requestId?: string;
  role: "user" | "assistant" | "system";
  text: string;
  tone?: TimelineTone;
  timestamp: string;
};
