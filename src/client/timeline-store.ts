import type { TimelineEntry, TimelineTone } from "./types";

const timelineStorageKey = "omg.timeline.v1";

export function createTimelineId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isTimelineTone(value: unknown): value is TimelineTone {
  return value === "error" || value === "user";
}

function normalizeTimelineEntries(entries: unknown[]) {
  let currentRequestId: string | undefined;

  return entries.flatMap((entry): TimelineEntry[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const candidate = entry as Partial<TimelineEntry>;

    if (
      !(candidate.role === "user" || candidate.role === "assistant" || candidate.role === "system") ||
      typeof candidate.text !== "string" ||
      typeof candidate.timestamp !== "string" ||
      (candidate.tone !== undefined && !isTimelineTone(candidate.tone))
    ) {
      return [];
    }

    const id = typeof candidate.id === "string" ? candidate.id : createTimelineId("entry");
    let requestId = typeof candidate.requestId === "string" ? candidate.requestId : undefined;

    if (!requestId && candidate.role === "user") {
      requestId = createTimelineId("request");
    }

    if (!requestId && currentRequestId && (candidate.role === "assistant" || candidate.tone === "error")) {
      requestId = currentRequestId;
    }

    if (candidate.role === "user") {
      currentRequestId = requestId;
    } else if (candidate.role === "assistant" || candidate.tone === "error") {
      currentRequestId = undefined;
    }

    return [
      {
        canvas: candidate.canvas,
        evidence: candidate.evidence,
        id,
        requestId,
        role: candidate.role,
        text: candidate.text,
        tone: candidate.tone,
        timestamp: candidate.timestamp,
      },
    ];
  });
}

export function loadTimelineEntries() {
  try {
    const raw = window.localStorage.getItem(timelineStorageKey);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeTimelineEntries(parsed);
  } catch {
    return [];
  }
}

export function saveTimelineEntries(entries: TimelineEntry[]) {
  try {
    window.localStorage.setItem(timelineStorageKey, JSON.stringify(entries));
  } catch {
    // Ignore storage failures; chat should still work without persistence.
  }
}

export function getTimelineTone(entry: TimelineEntry): TimelineTone | undefined {
  if (entry.tone) {
    return entry.tone;
  }

  if (entry.role === "user") {
    return "user";
  }

  if (entry.role === "system" && /^(NetworkError|Codex request failed|Unable to start Codex auth)\b/.test(entry.text)) {
    return "error";
  }

  return undefined;
}

export function isResponseEntry(entry: TimelineEntry) {
  return entry.role === "assistant" || getTimelineTone(entry) === "error";
}
