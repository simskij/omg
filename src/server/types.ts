export type AuthChallenge = {
  verificationUri: string;
  userCode: string;
  expiresInMinutes: number;
  startedAt: string;
};

export type ChatRequest = {
  message?: unknown;
};

export type ChatStatus = (message: string) => void;

export type ConversationEntry = {
  role: "assistant" | "user";
  text: string;
};

export type PrometheusQueryRequest = {
  query?: unknown;
  label?: unknown;
  match?: unknown;
  time?: unknown;
  start?: unknown;
  end?: unknown;
  step?: unknown;
};

export type CodexGrafanaToolCall = {
  action?: unknown;
  answer?: unknown;
  canvas?: unknown;
  interpretation?: unknown;
  nextChecks?: unknown;
  observations?: unknown;
  query?: unknown;
  label?: unknown;
  match?: unknown;
  unknowns?: unknown;
  time?: unknown;
  start?: unknown;
  end?: unknown;
  step?: unknown;
  reason?: unknown;
};

export type FactualObservation = {
  confidence: "computed" | "inferred" | "observed" | "unknown";
  evidence?: {
    query?: string;
    source?: "prometheus" | "user" | "memory" | "none";
  };
  text: string;
};

export type TurnEvidence = {
  queryResults: Array<{
    action: string;
    label?: string;
    match?: string;
    query?: string;
    result: unknown;
  }>;
  queries: Set<string>;
};

export type EvidenceSummary = {
  nextChecks: string[];
  observations: FactualObservation[];
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
