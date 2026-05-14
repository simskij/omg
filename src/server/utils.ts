import type { FactualObservation } from "./types";

export function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function getStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(getString).filter(Boolean) : [];
}

export function getObservations(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): FactualObservation[] => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const candidate = item as Partial<FactualObservation>;
    const text = getString(candidate.text);
    const confidence = candidate.confidence;

    if (!text || !(confidence === "computed" || confidence === "inferred" || confidence === "observed" || confidence === "unknown")) {
      return [];
    }

    const evidence = candidate.evidence && typeof candidate.evidence === "object" ? candidate.evidence : undefined;

    return [
      {
        confidence,
        evidence: {
          query: getString(evidence?.query) || undefined,
          source: evidence?.source,
        },
        text,
      },
    ];
  });
}

export function truncateForPrompt(value: unknown, maxLength = 12_000) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value, null, 2);

  if (serialized.length <= maxLength) {
    return serialized;
  }

  return `${serialized.slice(0, maxLength)}\n... truncated ...`;
}
