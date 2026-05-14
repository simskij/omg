import "./styles.css";

import {
  fetchCodexAuthStatus,
  fetchHealth,
  loadChatMemoryStatus,
  resetChatMemory,
  sendChatMessage,
  startCodexAuth,
} from "./api";
import { renderAppShell } from "./app-shell";
import { createServiceStatusController } from "./service-status";
import { createTimelineController } from "./timeline";
import type { CodexAuthChallenge } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

const elements = renderAppShell(app);
const { updateServiceStatus } = createServiceStatusController(elements.serviceStatusElement);
const timelineController = createTimelineController({
  exportPdfButton: elements.exportPdfButton,
  exportPngButton: elements.exportPngButton,
  loadChatMemoryStatus,
  sendChatMessage,
  sharedScroll: elements.sharedScroll,
  timeline: elements.timeline,
});

let codexAuthenticated = false;
let authStatusTimer: number | undefined;

function setChatEnabled(enabled: boolean) {
  codexAuthenticated = enabled;

  if (elements.chatInput) {
    elements.chatInput.disabled = !enabled;
    elements.chatInput.placeholder = enabled ? "Type a message..." : "Connect Codex to start chatting...";
  }

  if (elements.sendButton) {
    elements.sendButton.disabled = !enabled;
  }

  if (elements.connectCodexButton) {
    elements.connectCodexButton.classList.toggle("hidden", enabled);
    elements.connectCodexButton.textContent = "Connect Codex";
    elements.connectCodexButton.disabled = enabled;
  }
}

async function loadCodexStatus() {
  try {
    const status = await fetchCodexAuthStatus();

    setChatEnabled(status.authenticated);
    updateServiceStatus({ bun: "online", codex: status.authenticated ? "authenticated" : "unauthenticated" });

    if (status.authenticated && elements.authChallengeElement) {
      elements.authChallengeElement.classList.add("hidden");
    }

    return status.authenticated;
  } catch {
    setChatEnabled(false);
    updateServiceStatus({ codex: "error" });

    return false;
  }
}

function pollCodexStatus() {
  window.clearInterval(authStatusTimer);
  authStatusTimer = window.setInterval(async () => {
    const authenticated = await loadCodexStatus();

    if (authenticated) {
      window.clearInterval(authStatusTimer);
    }
  }, 2500);
}

function showAuthChallenge(challenge: CodexAuthChallenge) {
  elements.authChallengeElement?.classList.remove("hidden");

  if (elements.authLink) {
    elements.authLink.href = challenge.verificationUri;
    elements.authLink.textContent = challenge.verificationUri;
  }

  if (elements.authCode) {
    elements.authCode.textContent = challenge.userCode;
  }

  if (elements.authNote) {
    elements.authNote.textContent = `Expires in ${challenge.expiresInMinutes} minutes. This app will detect sign-in automatically.`;
  }
}

elements.exportPngButton?.addEventListener("click", () => {
  void timelineController.exportTimelineAsPng();
});

elements.exportPdfButton?.addEventListener("click", () => {
  void timelineController.exportTimelineAsPdf();
});

elements.resetTimelineButton?.addEventListener("click", () => {
  void timelineController.resetTimeline();
});

elements.resetTranscriptMemoryButton?.addEventListener("click", async () => {
  if (elements.resetTranscriptMemoryButton) {
    elements.resetTranscriptMemoryButton.disabled = true;
    elements.resetTranscriptMemoryButton.textContent = "Resetting...";
  }

  try {
    await resetChatMemory();
    await timelineController.resetTimeline();
  } catch (error) {
    timelineController.appendSystemError(error instanceof Error ? error.message : "Unable to reset chat memory");
  } finally {
    if (elements.resetTranscriptMemoryButton) {
      elements.resetTranscriptMemoryButton.disabled = false;
      elements.resetTranscriptMemoryButton.textContent = "Reset transcript and memory";
    }
  }
});

elements.connectCodexButton?.addEventListener("click", async () => {
  if (!elements.connectCodexButton) {
    return;
  }

  elements.connectCodexButton.disabled = true;
  elements.connectCodexButton.textContent = "Starting...";

  try {
    const challenge = await startCodexAuth();

    showAuthChallenge(challenge);
    elements.connectCodexButton.textContent = "Waiting...";
    pollCodexStatus();
  } catch (error) {
    elements.connectCodexButton.disabled = false;
    elements.connectCodexButton.textContent = "Connect Codex";
    timelineController.appendSystemError(error instanceof Error ? error.message : "Unable to start Codex auth");
  }
});

elements.chatForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = elements.chatInput?.value.trim();

  if (!message || !elements.chatInput || !codexAuthenticated) {
    return;
  }

  elements.chatInput.value = "";

  if (elements.sendButton) {
    elements.sendButton.disabled = true;
  }

  try {
    await timelineController.submitChatMessage(message);
  } finally {
    if (elements.sendButton) {
      elements.sendButton.disabled = !codexAuthenticated;
    }
  }
});

async function loadHealth() {
  try {
    const health = await fetchHealth();
    updateServiceStatus({ bun: health.status === "ok" ? "online" : "offline" });
  } catch {
    updateServiceStatus({ bun: "offline" });
  }
}

void timelineController.restoreTimeline().then(() => {
  if (timelineController.hasEntries()) {
    return;
  }

  window.setTimeout(() => {
    void timelineController.appendInitialWelcomeMessage();
  }, 700);
});
void loadHealth();
void loadCodexStatus();
