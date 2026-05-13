import ApexCharts from "apexcharts";
import "./styles.css";

type HealthResponse = {
  status: string;
  runtime: string;
  timestamp: string;
};

type CodexAuthStatus = {
  authenticated: boolean;
  details: string;
};

type CodexAuthChallenge = {
  verificationUri: string;
  userCode: string;
  expiresInMinutes: number;
  startedAt: string;
};

type ChatResponse = {
  canvas?: CanvasInstruction[];
  reply?: string;
  error?: string;
};

type SingleStatType = "numeric" | "percentage" | "bool";

type SingleStatProps = {
  label: string;
  type: SingleStatType;
  value: number | boolean;
};

type CanvasSingleStatInstruction = {
  type: "single_stat";
  label: string;
  dataType: SingleStatType;
  query?: string;
  value: number | boolean;
};

type CanvasGraphInstruction = {
  type: "graph";
  title: string;
  categories?: string[];
  query?: string;
  series: Array<{
    name: string;
    data: number[];
  }>;
};

type CanvasHeatmapInstruction = {
  type: "heatmap";
  title: string;
  columns: string[];
  query?: string;
  rows: Array<{
    label: string;
    values: Array<"ok" | "warning" | "critical" | "unknown">;
  }>;
};

type CanvasInstruction = CanvasSingleStatInstruction | CanvasGraphInstruction | CanvasHeatmapInstruction;

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

app.innerHTML = `
  <main class="h-dvh overflow-hidden bg-slate-950 text-slate-100">
    <section class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_480px]">
      <div class="hidden border-r border-white/10 bg-slate-900 lg:block"></div>

      <header class="border-b border-white/10 bg-slate-950 px-5 py-4">
          <div class="flex items-center justify-between gap-4">
            <div>
              <h2 class="text-lg font-semibold">Chat</h2>
              <p id="api-status" class="mt-1 text-xs text-slate-400">Checking services...</p>
            </div>
            <button id="connect-codex" class="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-100 transition hover:bg-cyan-300/20" type="button">
              Connect Codex
            </button>
          </div>
          <div id="auth-challenge" class="mt-4 hidden rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-cyan-50">
            <p class="font-medium">Finish Codex sign-in</p>
            <a id="auth-link" class="mt-2 block break-all text-cyan-200 underline" href="#" rel="noreferrer" target="_blank"></a>
            <p class="mt-3 text-slate-300">Enter this code in the browser:</p>
            <code id="auth-code" class="mt-2 block rounded-xl bg-slate-950/70 px-3 py-2 text-lg font-semibold tracking-[0.2em] text-white"></code>
            <p id="auth-note" class="mt-2 text-xs text-slate-400"></p>
          </div>
      </header>

      <div id="shared-scroll" class="col-span-full min-h-0 overflow-y-auto bg-slate-950">
        <div id="timeline" class="timeline-surface min-h-full"></div>
      </div>

      <div class="hidden border-r border-white/10 bg-slate-900 lg:block"></div>

      <form id="chat-form" class="border-t border-white/10 bg-slate-950/95 p-4">
          <div class="flex gap-3">
            <label class="sr-only" for="chat-input">Message</label>
            <input
              id="chat-input"
              class="min-w-0 flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/70 focus:bg-white/10"
              name="message"
              placeholder="Connect Codex to start chatting..."
              type="text"
              disabled
            />
            <button id="send-button" class="rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400" type="submit" disabled>
              Send
            </button>
          </div>
      </form>
    </section>
  </main>
`;

const statusElement = document.querySelector<HTMLParagraphElement>("#api-status");
const chatForm = document.querySelector<HTMLFormElement>("#chat-form");
const chatInput = document.querySelector<HTMLInputElement>("#chat-input");
const sharedScroll = document.querySelector<HTMLDivElement>("#shared-scroll");
const timeline = document.querySelector<HTMLDivElement>("#timeline");
const connectCodexButton = document.querySelector<HTMLButtonElement>("#connect-codex");
const authChallengeElement = document.querySelector<HTMLDivElement>("#auth-challenge");
const authLink = document.querySelector<HTMLAnchorElement>("#auth-link");
const authCode = document.querySelector<HTMLElement>("#auth-code");
const authNote = document.querySelector<HTMLParagraphElement>("#auth-note");
const sendButton = document.querySelector<HTMLButtonElement>("#send-button");

let codexAuthenticated = false;
let authStatusTimer: number | undefined;
let charts: ApexCharts[] = [];

function formatSingleStatValue({ type, value }: Pick<SingleStatProps, "type" | "value">) {
  if (type === "bool") {
    return value ? "✓" : "✕";
  }

  if (typeof value !== "number") {
    return "-";
  }

  if (type === "percentage") {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  }

  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function appendPanelHeader(parent: HTMLElement, title: string, query?: string) {
  const header = document.createElement("div");
  header.className = "mb-3 flex items-start justify-between gap-3";

  const heading = document.createElement("h2");
  heading.className = "text-xs font-medium uppercase tracking-[0.2em] text-slate-400";
  heading.textContent = title;
  header.append(heading);

  if (query) {
    const info = document.createElement("div");
    info.className = "group relative shrink-0";
    info.innerHTML = `
      <button class="flex h-6 w-6 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-xs font-semibold text-cyan-100" type="button" aria-label="Show PromQL query">i</button>
      <div class="pointer-events-none absolute right-0 top-8 z-20 hidden w-80 max-w-[70vw] rounded-2xl border border-white/10 bg-slate-950 p-3 text-left text-xs normal-case tracking-normal text-slate-200 shadow-2xl shadow-slate-950/60 group-hover:block">
        <p class="mb-2 font-semibold uppercase tracking-[0.18em] text-slate-500">PromQL</p>
        <pre class="whitespace-pre-wrap break-words font-mono leading-5"></pre>
      </div>
    `;
    const queryElement = info.querySelector("pre");

    if (queryElement) {
      queryElement.textContent = query;
    }

    header.append(info);
  }

  parent.append(header);
}

function createSingleStat({ label, type, value }: SingleStatProps, query?: string) {
  const card = document.createElement("article");
  card.className = "rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-2xl shadow-cyan-950/20 backdrop-blur";

  appendPanelHeader(card, label, query);

  const data = document.createElement("p");
  data.className =
    type === "bool"
      ? `mt-3 text-3xl font-semibold tracking-tight ${value ? "text-emerald-300" : "text-rose-300"}`
      : "mt-3 text-3xl font-semibold tracking-tight text-white";
  data.textContent = formatSingleStatValue({ type, value });

  card.append(data);
  return card;
}

function isSingleStatInstruction(value: CanvasInstruction): value is CanvasSingleStatInstruction {
  return value.type === "single_stat";
}

function isGraphInstruction(value: CanvasInstruction): value is CanvasGraphInstruction {
  return value.type === "graph";
}

function isHeatmapInstruction(value: CanvasInstruction): value is CanvasHeatmapInstruction {
  return value.type === "heatmap";
}

function heatmapCellClass(value: CanvasHeatmapInstruction["rows"][number]["values"][number]) {
  if (value === "critical") {
    return "bg-rose-500/80 text-white";
  }

  if (value === "warning") {
    return "bg-amber-400/80 text-slate-950";
  }

  if (value === "ok") {
    return "bg-emerald-400/70 text-slate-950";
  }

  return "bg-slate-700 text-slate-300";
}

function createSingleStatsGroup(stats: CanvasSingleStatInstruction[]) {
  const group = document.createElement("div");
  group.className = "grid gap-4 sm:grid-cols-3";
  group.append(
    ...stats.map((stat) =>
      createSingleStat(
        {
          label: stat.label,
          type: stat.dataType,
          value: stat.value,
        },
        stat.query,
      ),
    ),
  );

  return group;
}

function appendGraphPanel(parent: HTMLElement, instruction: CanvasGraphInstruction) {
  const card = document.createElement("section");
  card.className = "rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-2xl shadow-cyan-950/20 backdrop-blur";

  const graph = document.createElement("div");
  appendPanelHeader(card, instruction.title, instruction.query);
  card.append(graph);
  parent.append(card);

  window.requestAnimationFrame(() => {
    const chart = new ApexCharts(graph, {
      chart: {
        background: "transparent",
        fontFamily: "inherit",
        height: 288,
        toolbar: { show: false },
        type: "area",
      },
      colors: ["#67e8f9", "#a78bfa", "#34d399", "#fb7185", "#fbbf24", "#f472b6"],
      dataLabels: { enabled: false },
      fill: {
        gradient: {
          opacityFrom: 0.28,
          opacityTo: 0.02,
          shadeIntensity: 1,
        },
        type: "gradient",
      },
      grid: {
        borderColor: "rgba(148, 163, 184, 0.16)",
        strokeDashArray: 4,
      },
      legend: {
        labels: { colors: "#cbd5e1" },
      },
      series: instruction.series,
      stroke: {
        curve: "smooth",
        width: 3,
      },
      theme: { mode: "dark" },
      tooltip: { theme: "dark" },
      xaxis: {
        axisBorder: { show: false },
        axisTicks: { show: false },
        categories: instruction.categories,
        labels: { style: { colors: "#94a3b8" } },
      },
      yaxis: {
        labels: { style: { colors: "#94a3b8" } },
      },
    });

    void chart.render();
    charts.push(chart);
  });

  return card;
}

function createHeatmapPanel(instruction: CanvasHeatmapInstruction) {
  const card = document.createElement("section");
  card.className =
    "overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-2xl shadow-cyan-950/20 backdrop-blur";

  const table = document.createElement("div");
  table.className = "grid min-w-max gap-2";
  table.style.gridTemplateColumns = `minmax(9rem, 1fr) repeat(${instruction.columns.length}, minmax(5rem, 1fr))`;

  const emptyHeader = document.createElement("div");
  table.append(emptyHeader);

  for (const column of instruction.columns) {
    const header = document.createElement("div");
    header.className = "text-xs font-medium uppercase tracking-[0.16em] text-slate-400";
    header.textContent = column;
    table.append(header);
  }

  for (const row of instruction.rows) {
    const label = document.createElement("div");
    label.className = "truncate py-2 text-sm font-medium text-slate-200";
    label.textContent = row.label;
    table.append(label);

    for (const value of row.values) {
      const cell = document.createElement("div");
      cell.className = `rounded-lg px-3 py-2 text-center text-xs font-semibold uppercase ${heatmapCellClass(value)}`;
      cell.textContent = value;
      table.append(cell);
    }
  }

  appendPanelHeader(card, instruction.title, instruction.query);
  card.append(table);
  return card;
}

async function renderCanvasInstructions(instructions: CanvasInstruction[]) {
  const group = document.createElement("section");
  group.className = "flex flex-col gap-4 border-b border-dashed border-slate-500/40 pb-6 last:border-b-0";

  const stats = instructions.filter(isSingleStatInstruction);
  const graphs = instructions.filter(isGraphInstruction);
  const heatmaps = instructions.filter(isHeatmapInstruction);

  if (stats.length > 0) {
    group.append(createSingleStatsGroup(stats));
  }

  for (const graph of graphs) {
    appendGraphPanel(group, graph);
  }

  for (const heatmap of heatmaps) {
    group.append(createHeatmapPanel(heatmap));
  }

  return group;
}

function createTimelineRow() {
  const row = document.createElement("div");
  row.className = "grid min-h-24 lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_480px]";

  const canvasCell = document.createElement("div");
  canvasCell.className =
    "relative min-h-24 border-b border-r border-white/10 bg-transparent p-8 lg:border-b-0";

  const canvasContent = document.createElement("div");
  canvasContent.className = "relative mx-auto w-full max-w-5xl";

  const chatCell = document.createElement("div");
  chatCell.className = "border-b border-white/10 bg-slate-950 px-5 py-5";

  canvasCell.append(canvasContent);
  row.append(canvasCell, chatCell);
  timeline?.append(row);

  return { canvasContent, chatCell, row };
}

function formatTimelineTimestamp(date = new Date()) {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function appendTimelineTimestamp(canvasContent: HTMLElement, chatCell: HTMLElement) {
  const canvasTimestamp = document.createElement("p");
  canvasTimestamp.className = "mb-3 text-xs font-medium uppercase tracking-[0.2em] text-slate-500";
  canvasTimestamp.textContent = formatTimelineTimestamp();

  const chatTimestamp = document.createElement("p");
  chatTimestamp.className = "mb-3 text-xs font-medium uppercase tracking-[0.2em] text-slate-500";
  chatTimestamp.textContent = canvasTimestamp.textContent;

  canvasContent.append(canvasTimestamp);
  chatCell.append(chatTimestamp);
}

function setChatEnabled(enabled: boolean) {
  codexAuthenticated = enabled;

  if (chatInput) {
    chatInput.disabled = !enabled;
    chatInput.placeholder = enabled ? "Type a message..." : "Connect Codex to start chatting...";
  }

  if (sendButton) {
    sendButton.disabled = !enabled;
  }

  if (connectCodexButton) {
    connectCodexButton.textContent = enabled ? "Codex Connected" : "Connect Codex";
    connectCodexButton.disabled = enabled;
  }
}

function appendMessage(text: string, role: "user" | "assistant" | "system") {
  if (!timeline) {
    return null;
  }

  const { chatCell } = createTimelineRow();

  const messageElement = document.createElement("article");

  if (role === "user") {
    messageElement.className =
      "ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-cyan-400 px-4 py-3 text-sm leading-6 text-slate-950";
  } else if (role === "assistant") {
    messageElement.className =
      "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-white/10 px-4 py-3 text-sm leading-6 text-slate-100";
  } else {
    messageElement.className =
      "mx-auto max-w-[90%] rounded-full border border-white/10 bg-white/5 px-4 py-2 text-center text-xs text-slate-400";
  }

  messageElement.textContent = text;
  chatCell.append(messageElement);
  sharedScroll?.scrollTo({ top: sharedScroll.scrollHeight });

  return messageElement;
}

function appendAssistantResponse(text: string, canvasGroup: HTMLElement | null) {
  if (!timeline) {
    return null;
  }

  const { canvasContent, chatCell } = createTimelineRow();

  appendTimelineTimestamp(canvasContent, chatCell);

  if (canvasGroup) {
    canvasContent.append(canvasGroup);
  }

  const messageElement = document.createElement("article");
  messageElement.className =
    "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-white/10 px-4 py-3 text-sm leading-6 text-slate-100";
  messageElement.textContent = text;
  chatCell.append(messageElement);
  matchMessageHeightToCanvas(messageElement, canvasGroup);
  sharedScroll?.scrollTo({ top: sharedScroll.scrollHeight });

  return messageElement;
}

function matchMessageHeightToCanvas(messageElement: HTMLElement | null, canvasGroup: HTMLElement | null) {
  if (!messageElement || !canvasGroup) {
    return;
  }

  window.requestAnimationFrame(() => {
    messageElement.style.minHeight = `${Math.ceil(canvasGroup.getBoundingClientRect().height)}px`;
  });
}

function appendThinkingIndicator() {
  if (!timeline) {
    return null;
  }

  const { chatCell, row } = createTimelineRow();

  const indicator = document.createElement("article");
  indicator.className =
    "flex max-w-[85%] items-center gap-2 rounded-2xl rounded-tl-sm bg-white/10 px-4 py-3 text-sm leading-6 text-slate-300";
  indicator.setAttribute("aria-live", "polite");
  indicator.innerHTML = `
    <span class="h-2 w-2 animate-pulse rounded-full bg-cyan-200"></span>
    <span class="h-2 w-2 animate-pulse rounded-full bg-cyan-200 [animation-delay:150ms]"></span>
    <span class="h-2 w-2 animate-pulse rounded-full bg-cyan-200 [animation-delay:300ms]"></span>
    <span class="ml-1 text-xs text-slate-400">Thinking...</span>
  `;

  chatCell.append(indicator);
  sharedScroll?.scrollTo({ top: sharedScroll.scrollHeight });

  return { indicator, row };
}

window.setTimeout(() => {
  appendMessage(
    "Hi, welcome to OMG! I'm your personal telemetry visualization buddy. Ask me about your telemetry, and I'll help you investigate what's going on.",
    "assistant",
  );
}, 700);

async function loadCodexStatus() {
  try {
    const response = await fetch("/api/codex/auth/status");
    const status = (await response.json()) as CodexAuthStatus;

    setChatEnabled(status.authenticated);

    if (statusElement) {
      statusElement.textContent = status.authenticated ? "Bun online, Codex authenticated" : "Bun online, Codex not connected";
    }

    if (status.authenticated && authChallengeElement) {
      authChallengeElement.classList.add("hidden");
    }

    return status.authenticated;
  } catch {
    setChatEnabled(false);

    if (statusElement) {
      statusElement.textContent = "Unable to read Codex auth status";
    }

    return false;
  }
}

function pollCodexStatus() {
  window.clearInterval(authStatusTimer);
  authStatusTimer = window.setInterval(async () => {
    const authenticated = await loadCodexStatus();

    if (authenticated) {
      window.clearInterval(authStatusTimer);
      appendMessage("Codex is connected. You can start chatting.", "system");
    }
  }, 2500);
}

function showAuthChallenge(challenge: CodexAuthChallenge) {
  authChallengeElement?.classList.remove("hidden");

  if (authLink) {
    authLink.href = challenge.verificationUri;
    authLink.textContent = challenge.verificationUri;
  }

  if (authCode) {
    authCode.textContent = challenge.userCode;
  }

  if (authNote) {
    authNote.textContent = `Expires in ${challenge.expiresInMinutes} minutes. This app will detect sign-in automatically.`;
  }
}

connectCodexButton?.addEventListener("click", async () => {
  connectCodexButton.disabled = true;
  connectCodexButton.textContent = "Starting...";

  try {
    const response = await fetch("/api/codex/auth/start", { method: "POST" });
    const result = (await response.json()) as { challenge?: CodexAuthChallenge; error?: string };

    if (!response.ok || !result.challenge) {
      throw new Error(result.error ?? "Unable to start Codex auth");
    }

    showAuthChallenge(result.challenge);
    connectCodexButton.textContent = "Waiting...";
    pollCodexStatus();
  } catch (error) {
    connectCodexButton.disabled = false;
    connectCodexButton.textContent = "Connect Codex";
    appendMessage(error instanceof Error ? error.message : "Unable to start Codex auth", "system");
  }
});

chatForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = chatInput?.value.trim();

  if (!message || !chatInput || !codexAuthenticated) {
    return;
  }

  appendMessage(message, "user");
  chatInput.value = "";
  const thinkingIndicator = appendThinkingIndicator();

  if (sendButton) {
    sendButton.disabled = true;
    sendButton.textContent = "Sending...";
  }

  try {
    const response = await fetch("/api/chat", {
      body: JSON.stringify({ message }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = (await response.json()) as ChatResponse;

    if (!response.ok || !result.reply) {
      throw new Error(result.error ?? "Codex request failed");
    }

    thinkingIndicator?.row.remove();
    const canvasGroup = result.canvas?.length ? await renderCanvasInstructions(result.canvas) : null;
    appendAssistantResponse(result.reply, canvasGroup);
  } catch (error) {
    thinkingIndicator?.row.remove();
    appendMessage(error instanceof Error ? error.message : "Codex request failed", "system");
  } finally {
    if (sendButton) {
      sendButton.disabled = !codexAuthenticated;
      sendButton.textContent = "Send";
    }
  }
});

async function loadHealth() {
  try {
    const response = await fetch("/api/health");

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const health = (await response.json()) as HealthResponse;

    if (statusElement) {
      statusElement.textContent = `${health.status} via ${health.runtime}`;
    }
  } catch (error) {
    if (statusElement) {
      statusElement.textContent = error instanceof Error ? error.message : "Backend unavailable";
    }
  }
}

void loadHealth();
void loadCodexStatus();
