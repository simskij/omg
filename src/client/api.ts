import type {
  CanvasInstruction,
  ChatMemoryStatus,
  ChatResponse,
  ChatStreamEvent,
  CodexAuthChallenge,
  CodexAuthStatus,
  EvidenceSummary,
  HealthResponse,
} from "./types";

export async function fetchHealth() {
  const response = await fetch("/api/health");

  if (!response.ok) {
    throw new Error(`Backend returned ${response.status}`);
  }

  return (await response.json()) as HealthResponse;
}

export async function fetchCodexAuthStatus() {
  const response = await fetch("/api/codex/auth/status");

  return (await response.json()) as CodexAuthStatus;
}

export async function startCodexAuth() {
  const response = await fetch("/api/codex/auth/start", { method: "POST" });
  const result = (await response.json()) as { challenge?: CodexAuthChallenge; error?: string };

  if (!response.ok || !result.challenge) {
    throw new Error(result.error ?? "Unable to start Codex auth");
  }

  return result.challenge;
}

export async function resetChatMemory() {
  const response = await fetch("/api/chat/memory/reset", { method: "POST" });

  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: string } | null;

    throw new Error(result?.error ?? "Unable to reset chat memory");
  }
}

export async function loadChatMemoryStatus() {
  const response = await fetch("/api/chat/memory");

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as ChatMemoryStatus;
}

export async function sendChatMessage(
  message: string,
  onStatus?: (status: string) => void,
): Promise<{ canvas?: CanvasInstruction[]; compressed?: boolean; evidence?: EvidenceSummary; memory?: ChatMemoryStatus; reply: string }> {
  const response = await fetch("/api/chat/stream", {
    body: JSON.stringify({ message }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok || !response.body) {
    const result = (await response.json().catch(() => null)) as ChatResponse | null;

    throw new Error(result?.error ?? "Codex request failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const event = JSON.parse(line) as ChatStreamEvent;

      if (event.type === "status") {
        onStatus?.(event.status);
        continue;
      }

      if (event.type === "error") {
        throw new Error(event.error);
      }

      return { canvas: event.canvas, compressed: event.compressed, evidence: event.evidence, memory: event.memory, reply: event.reply };
    }
  }

  if (buffer.trim()) {
    const event = JSON.parse(buffer) as ChatStreamEvent;

    if (event.type === "result") {
      return { canvas: event.canvas, compressed: event.compressed, evidence: event.evidence, memory: event.memory, reply: event.reply };
    }

    if (event.type === "error") {
      throw new Error(event.error);
    }
  }

  throw new Error("Codex request completed without a result");
}
