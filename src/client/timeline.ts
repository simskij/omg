import { destroyCharts, renderCanvasInstructions } from "./canvas";
import { createTimelineId, getTimelineTone, isResponseEntry, loadTimelineEntries, saveTimelineEntries } from "./timeline-store";
import type { CanvasInstruction, ChatMemoryStatus, EvidenceSummary, TimelineEntry, TimelineTone } from "./types";

const projectLogoMarkdown = [
  "```",
  "                              ██████╗ ██╗  ██╗    ███╗   ███╗██╗   ██╗",
  "                             ██╔═══██╗██║  ██║    ████╗ ████║╚██╗ ██╔╝",
  "                             ██║   ██║███████║    ██╔████╔██║ ╚████╔╝",
  "                             ██║   ██║██╔══██║    ██║╚██╔╝██║  ╚██╔╝",
  "                             ╚██████╔╝██║  ██║    ██║ ╚═╝ ██║   ██║",
  "                              ╚═════╝ ╚═╝  ╚═╝    ╚═╝     ╚═╝   ╚═╝",
  "",
  "                          ██████╗ ██████╗  █████╗ ██████╗ ██╗  ██╗    ██╗",
  "                         ██╔════╝ ██╔══██╗██╔══██╗██╔══██╗██║  ██║    ██║",
  "                         ██║  ███╗██████╔╝███████║██████╔╝███████║    ██║",
  "                         ██║   ██║██╔══██╗██╔══██║██╔═══╝ ██╔══██║    ╚═╝",
  "                         ╚██████╔╝██║  ██║██║  ██║██║     ██║  ██║    ██╗",
  "                          ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝    ╚═╝",
  "```",
].join("\n");

type SendChatMessage = (
  message: string,
  onStatus?: (status: string) => void,
) => Promise<{ canvas?: CanvasInstruction[]; compressed?: boolean; evidence?: EvidenceSummary; memory?: ChatMemoryStatus; reply: string }>;

type TimelineControllerOptions = {
  exportPdfButton: HTMLButtonElement | null;
  exportPngButton: HTMLButtonElement | null;
  loadChatMemoryStatus: () => Promise<ChatMemoryStatus | null>;
  sendChatMessage: SendChatMessage;
  sharedScroll: HTMLDivElement | null;
  timeline: HTMLDivElement | null;
};

function appendEvidenceSection(parent: HTMLElement, title: string, items: string[]) {
  if (items.length === 0) {
    return;
  }

  const section = document.createElement("section");
  section.className = "mt-4";

  const heading = document.createElement("h4");
  heading.className = "text-xs font-semibold uppercase tracking-[0.18em] text-slate-500";
  heading.textContent = title;
  section.append(heading);

  const list = document.createElement("ul");
  list.className = "mt-2 space-y-2 text-sm text-slate-300";

  for (const item of items) {
    const row = document.createElement("li");
    row.className = "rounded-xl bg-white/[0.03] px-3 py-2";
    row.textContent = item;
    list.append(row);
  }

  section.append(list);
  parent.append(section);
}

function createEvidenceContent(evidence: EvidenceSummary) {
  const content = document.createElement("div");

  const title = document.createElement("h3");
  title.className = "text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200";
  title.textContent = "Evidence";
  content.append(title);

  const queryList = document.createElement("div");
  queryList.className = "mt-3 space-y-3";

  for (const query of evidence.queries) {
    const card = document.createElement("article");
    card.className = "rounded-xl border border-white/10 bg-white/[0.03] p-3";

    const meta = document.createElement("div");
    meta.className = "flex flex-wrap gap-2 text-xs text-slate-400";
    meta.textContent = `${query.action.replace("grafana_prometheus_", "")} | ${query.empty ? "empty" : "non-empty"} | ${query.seriesCount} series | ${query.sampleCount} samples`;
    card.append(meta);

    const source = query.query ?? query.match ?? query.label;

    if (source) {
      const pre = document.createElement("pre");
      pre.className = "mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-200";
      pre.textContent = source;
      card.append(pre);
    }

    queryList.append(card);
  }

  if (evidence.queries.length > 0) {
    content.append(queryList);
  }

  appendEvidenceSection(
    content,
    "Observations",
    evidence.observations.map((observation) => `[${observation.confidence}] ${observation.text}`),
  );
  appendEvidenceSection(content, "Unknowns", evidence.unknowns);
  appendEvidenceSection(content, "Next Checks", evidence.nextChecks);

  return content;
}

function closeEvidenceModal() {
  document.querySelector(".evidence-modal")?.remove();
}

function openEvidenceModal(evidence: EvidenceSummary) {
  closeEvidenceModal();

  const modal = document.createElement("div");
  modal.className = "evidence-modal fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Evidence details");

  const panel = document.createElement("div");
  panel.className = "max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-cyan-300/20 bg-slate-950 p-5 text-left shadow-2xl shadow-slate-950";

  const close = document.createElement("button");
  close.className = "float-right flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-300/40";
  close.type = "button";
  close.setAttribute("aria-label", "Close evidence");
  close.innerHTML = `<svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
  close.addEventListener("click", closeEvidenceModal);

  panel.append(close, createEvidenceContent(evidence));
  modal.append(panel);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeEvidenceModal();
    }
  });
  document.body.append(modal);
  close.focus();
}

export function createTimelineController({
  exportPdfButton,
  exportPngButton,
  loadChatMemoryStatus,
  sendChatMessage,
  sharedScroll,
  timeline,
}: TimelineControllerOptions) {
  let timelineEntries: TimelineEntry[] = loadTimelineEntries();
  let retryingRequestId: string | undefined;

  function persistTimelineEntry(entry: TimelineEntry) {
    timelineEntries = [...timelineEntries, entry].slice(-100);
    saveTimelineEntries(timelineEntries);
  }

  function replaceTimelineEntry(id: string, entry: TimelineEntry) {
    timelineEntries = timelineEntries.map((candidate) => (candidate.id === id ? entry : candidate));
    saveTimelineEntries(timelineEntries);
  }

  function removeTimelineEntries(predicate: (entry: TimelineEntry) => boolean) {
    timelineEntries = timelineEntries.filter((entry) => !predicate(entry));
    saveTimelineEntries(timelineEntries);
  }

  function getLatestRetryableRequestId() {
    for (let index = timelineEntries.length - 1; index >= 0; index -= 1) {
      const entry = timelineEntries[index];

      if (entry.role !== "user" || !entry.requestId) {
        continue;
      }

      const hasResponse = timelineEntries.some(
        (candidate, candidateIndex) => candidateIndex > index && candidate.requestId === entry.requestId && isResponseEntry(candidate),
      );

      return hasResponse ? entry.requestId : undefined;
    }

    return undefined;
  }

  function findTurnUserEntry(requestId: string) {
    return timelineEntries.find((entry) => entry.requestId === requestId && entry.role === "user");
  }

  function findTurnResponseEntry(requestId: string) {
    return timelineEntries.find((entry) => entry.requestId === requestId && isResponseEntry(entry));
  }

  function createTimelineRow(options?: { borderless?: boolean; tone?: TimelineTone }) {
    const row = document.createElement("div");
    row.className = "group/timeline-row grid min-h-24 border-b border-white/10 lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_480px]";

    if (options?.borderless) {
      row.classList.remove("border-b", "border-white/10");
    }

    if (options?.tone === "error") {
      row.classList.add("bg-red-950/10");
    } else if (options?.tone === "user") {
      row.classList.add("bg-cyan-400/[0.03]");
    }

    const canvasCell = document.createElement("div");
    canvasCell.className = "relative min-h-24 border-r border-white/10 bg-transparent p-8";

    const canvasContent = document.createElement("div");
    canvasContent.className = "relative mx-auto w-full max-w-5xl";

    const chatCell = document.createElement("div");
    chatCell.className =
      options?.tone === "error"
        ? "relative bg-red-950/10 px-5 py-5"
        : options?.tone === "user"
          ? "relative bg-cyan-400/[0.03] px-5 py-5"
          : "relative bg-slate-950 px-5 py-5";

    canvasCell.append(canvasContent);
    row.append(canvasCell, chatCell);
    timeline?.append(row);

    return { canvasContent, chatCell, row };
  }

  function formatTimelineTimestamp(date: Date | string = new Date()) {
    const timestamp = typeof date === "string" ? new Date(date) : date;

    return timestamp.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function appendTimelineTimestamp(canvasContent: HTMLElement, chatCell: HTMLElement, timestamp?: string) {
    const canvasTimestamp = document.createElement("p");
    canvasTimestamp.className = "mb-3 text-xs font-medium uppercase tracking-[0.2em] text-slate-500";
    canvasTimestamp.textContent = formatTimelineTimestamp(timestamp);

    const chatTimestamp = document.createElement("p");
    chatTimestamp.className = "mb-3 text-xs font-medium uppercase tracking-[0.2em] text-slate-500";
    chatTimestamp.textContent = canvasTimestamp.textContent;

    canvasContent.append(canvasTimestamp);
    chatCell.append(chatTimestamp);
  }

  function getExportFilename(extension: "png" | "pdf") {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    return `omg-timeline-${timestamp}.${extension}`;
  }

  function downloadUrl(url: string, filename: string) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  }

  async function captureTimelineCanvas() {
    if (!timeline) {
      throw new Error("Timeline is unavailable");
    }

    if (!timeline.children.length) {
      throw new Error("There is no timeline to export");
    }

    const { default: html2canvas } = await import("html2canvas");

    return html2canvas(timeline, {
      backgroundColor: "#0f172a",
      height: timeline.scrollHeight,
      ignoreElements: (element) => element.classList.contains("timeline-actions"),
      scale: Math.min(window.devicePixelRatio || 1, 2),
      useCORS: true,
      width: timeline.scrollWidth,
      windowHeight: timeline.scrollHeight,
      windowWidth: timeline.scrollWidth,
    });
  }

  function setExportButtonsEnabled(enabled: boolean) {
    if (exportPngButton) {
      exportPngButton.disabled = !enabled;
      exportPngButton.textContent = enabled ? "Export PNG" : "Exporting...";
    }

    if (exportPdfButton) {
      exportPdfButton.disabled = !enabled;
      exportPdfButton.textContent = enabled ? "Export PDF" : "Exporting...";
    }
  }

  function createIconButton(label: string, icon: "delete" | "evidence" | "retry", onClick: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      icon === "delete"
        ? "flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-slate-950/60 text-slate-500 transition hover:border-red-300/30 hover:bg-red-300/10 hover:text-red-100 focus:outline-none focus:ring-2 focus:ring-red-300/40"
        : "flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-slate-950/60 text-slate-500 transition hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/40";
    button.setAttribute("aria-label", label);
    button.title = label;
    if (icon === "delete") {
      button.innerHTML = `<svg aria-hidden="true" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>`;
    } else if (icon === "evidence") {
      button.innerHTML = `<svg aria-hidden="true" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/><path d="M8 9h2"/></svg>`;
    } else {
      button.innerHTML = `<svg aria-hidden="true" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>`;
    }
    button.addEventListener("click", onClick);

    return button;
  }

  function showEvidence(entry: TimelineEntry) {
    if (!entry.evidence) {
      return;
    }

    openEvidenceModal(entry.evidence);
  }

  function appendTimelineActions(chatCell: HTMLElement, entry: TimelineEntry) {
    if (entry.requestId && entry.requestId === retryingRequestId) {
      return;
    }

    if (entry.role === "user" && entry.requestId && !findTurnResponseEntry(entry.requestId)) {
      return;
    }

    const actions = document.createElement("div");
    actions.className =
      "timeline-actions absolute right-3 top-3 z-10 flex gap-1 opacity-0 transition focus-within:opacity-100 group-hover/timeline-row:opacity-100";

    const latestRetryableRequestId = getLatestRetryableRequestId();
    const canRetry = Boolean(entry.requestId && entry.requestId === latestRetryableRequestId && !retryingRequestId);

    if (canRetry) {
      actions.append(
        createIconButton("Retry latest turn", "retry", () => {
          if (entry.requestId) {
            void retryTurn(entry.requestId);
          }
        }),
      );
    }

    if (entry.role === "assistant" && entry.evidence) {
      actions.append(createIconButton("Show evidence", "evidence", () => showEvidence(entry)));
    }

    actions.append(
      createIconButton(entry.role === "user" ? "Delete turn" : "Delete response", "delete", () => {
        deleteTimelineEntry(entry);
      }),
    );

    chatCell.append(actions);
  }

  async function exportTimelineAsPng() {
    setExportButtonsEnabled(false);

    try {
      const canvas = await captureTimelineCanvas();
      downloadUrl(canvas.toDataURL("image/png"), getExportFilename("png"));
    } catch (error) {
      appendMessage(error instanceof Error ? error.message : "Timeline PNG export failed", "system", { tone: "error" });
    } finally {
      setExportButtonsEnabled(true);
    }
  }

  async function exportTimelineAsPdf() {
    setExportButtonsEnabled(false);

    try {
      const { jsPDF } = await import("jspdf");
      const canvas = await captureTimelineCanvas();
      const imageData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imageHeight = (canvas.height * pageWidth) / canvas.width;
      let remainingHeight = imageHeight;
      let y = 0;

      pdf.addImage(imageData, "PNG", 0, y, pageWidth, imageHeight);
      remainingHeight -= pageHeight;

      while (remainingHeight > 0) {
        y -= pageHeight;
        pdf.addPage();
        pdf.addImage(imageData, "PNG", 0, y, pageWidth, imageHeight);
        remainingHeight -= pageHeight;
      }

      pdf.save(getExportFilename("pdf"));
    } catch (error) {
      appendMessage(error instanceof Error ? error.message : "Timeline PDF export failed", "system", { tone: "error" });
    } finally {
      setExportButtonsEnabled(true);
    }
  }

  function appendMessage(
    text: string,
    role: "user" | "assistant" | "system",
    options?: { id?: string; persist?: boolean; requestId?: string; timestamp?: string; tone?: TimelineTone },
  ) {
    if (!timeline) {
      return null;
    }

    const timestamp = options?.timestamp ?? new Date().toISOString();

    const tone = options?.tone ?? (role === "user" ? "user" : undefined);
    const entry: TimelineEntry = {
      id: options?.id ?? createTimelineId("entry"),
      requestId: options?.requestId,
      role,
      text,
      tone,
      timestamp,
    };

    const { chatCell } = createTimelineRow({ tone });
    appendTimelineActions(chatCell, entry);

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

    if (options?.persist !== false) {
      persistTimelineEntry(entry);
    }

    return messageElement;
  }

  function appendAssistantResponse(
    text: string,
    canvasGroup: HTMLElement | null,
    options?: { canvas?: CanvasInstruction[]; evidence?: EvidenceSummary; id?: string; persist?: boolean; requestId?: string; timestamp?: string },
  ) {
    if (!timeline) {
      return null;
    }

    const timestamp = options?.timestamp ?? new Date().toISOString();
    const entry: TimelineEntry = {
      canvas: options?.canvas,
      evidence: options?.evidence,
      id: options?.id ?? createTimelineId("entry"),
      requestId: options?.requestId,
      role: "assistant",
      text,
      timestamp,
    };

    const { canvasContent, chatCell } = createTimelineRow();
    appendTimelineActions(chatCell, entry);

    appendTimelineTimestamp(canvasContent, chatCell, timestamp);

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

    if (options?.persist !== false) {
      persistTimelineEntry(entry);
    }

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

  function createThinkingIndicatorElement() {
    const indicator = document.createElement("div");
    indicator.className = "flex h-12 items-center justify-start gap-3 text-cyan-200";
    indicator.setAttribute("aria-label", "Thinking");
    indicator.setAttribute("aria-live", "polite");
    indicator.innerHTML = `
      <span class="relative flex h-7 w-7 shrink-0 items-center justify-center">
        <span class="absolute h-full w-full animate-ping rounded-full bg-cyan-300/25"></span>
        <span class="absolute h-full w-full animate-spin rounded-full border-2 border-cyan-200/20 border-t-cyan-200"></span>
        <span class="h-2 w-2 rounded-full bg-cyan-100 shadow-[0_0_16px_rgba(103,232,249,0.9)]"></span>
      </span>
      <span class="thinking-status text-xs font-medium uppercase tracking-[0.22em] text-slate-400">Starting investigation</span>
    `;

    return indicator;
  }

  function createCompressingIndicatorElement() {
    const indicator = document.createElement("div");
    indicator.className = "flex h-16 items-center gap-4 text-cyan-100";
    indicator.setAttribute("aria-label", "Compressing chat history");
    indicator.setAttribute("aria-live", "polite");
    indicator.innerHTML = `
      <span class="relative grid h-10 w-14 place-items-center overflow-hidden rounded-2xl border border-cyan-200/20 bg-cyan-200/10 shadow-[0_0_30px_rgba(8,145,178,0.22)]">
        <span class="absolute left-2 h-7 w-1 animate-pulse rounded-full bg-cyan-100/80"></span>
        <span class="absolute left-5 h-7 w-1 animate-pulse rounded-full bg-cyan-100/60 [animation-delay:120ms]"></span>
        <span class="absolute left-8 h-7 w-1 animate-pulse rounded-full bg-cyan-100/40 [animation-delay:240ms]"></span>
        <span class="absolute right-2 h-7 w-1 animate-pulse rounded-full bg-cyan-100/80 [animation-delay:360ms]"></span>
        <span class="absolute h-px w-20 animate-[spin_1.8s_linear_infinite] bg-gradient-to-r from-transparent via-cyan-100 to-transparent"></span>
      </span>
      <span class="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">Compressing memory</span>
    `;

    return indicator;
  }

  function appendThinkingIndicator() {
    if (!timeline) {
      return null;
    }

    const { chatCell, row } = createTimelineRow({ borderless: true });
    const indicator = createThinkingIndicatorElement();

    chatCell.append(indicator);
    sharedScroll?.scrollTo({ top: sharedScroll.scrollHeight });

    return {
      indicator,
      row,
      updateStatus(status: string) {
        const statusElement = indicator.querySelector(".thinking-status");

        if (statusElement) {
          statusElement.textContent = status;
        }
      },
    };
  }

  function appendCompressingIndicator() {
    if (!timeline) {
      return null;
    }

    const { chatCell, row } = createTimelineRow({ borderless: true });
    const indicator = createCompressingIndicatorElement();

    chatCell.append(indicator);
    sharedScroll?.scrollTo({ top: sharedScroll.scrollHeight });

    return {
      indicator,
      row,
      updateStatus(status: string) {
        const statusElement = indicator.querySelector("span:last-child");

        if (statusElement) {
          statusElement.textContent = status;
        }
      },
    };
  }

  function deleteTimelineEntry(entry: TimelineEntry) {
    if (entry.role === "user" && entry.requestId) {
      removeTimelineEntries((candidate) => candidate.requestId === entry.requestId);
    } else {
      removeTimelineEntries((candidate) => candidate.id === entry.id);
    }

    void renderTimeline();
  }

  async function retryTurn(requestId: string) {
    if (retryingRequestId || requestId !== getLatestRetryableRequestId()) {
      return;
    }

    const userEntry = findTurnUserEntry(requestId);
    const responseEntry = findTurnResponseEntry(requestId);

    if (!userEntry || !responseEntry) {
      return;
    }

    retryingRequestId = requestId;
    await renderTimeline();

    try {
      const result = await sendChatMessage(userEntry.text);
      replaceTimelineEntry(responseEntry.id, {
        canvas: result.canvas,
        evidence: result.evidence,
        id: responseEntry.id,
        requestId,
        role: "assistant",
        text: result.reply,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      replaceTimelineEntry(responseEntry.id, {
        id: responseEntry.id,
        requestId,
        role: "system",
        text: error instanceof Error ? error.message : "Codex request failed",
        timestamp: new Date().toISOString(),
        tone: "error",
      });
    } finally {
      retryingRequestId = undefined;
      await renderTimeline();
    }
  }

  async function renderTimeline() {
    if (!timeline) {
      return;
    }

    destroyCharts();
    timeline.replaceChildren();

    for (const entry of timelineEntries) {
      if (entry.role === "assistant") {
        if (entry.requestId && entry.requestId === retryingRequestId) {
          const { canvasContent, chatCell } = createTimelineRow();
          appendTimelineTimestamp(canvasContent, chatCell, entry.timestamp);
          chatCell.append(createThinkingIndicatorElement());
          continue;
        }

        const canvasGroup = entry.canvas?.length ? await renderCanvasInstructions(entry.canvas) : null;

        appendAssistantResponse(entry.text, canvasGroup, {
          canvas: entry.canvas,
          evidence: entry.evidence,
          id: entry.id,
          persist: false,
          requestId: entry.requestId,
          timestamp: entry.timestamp,
        });
        continue;
      }

      if (entry.requestId && entry.requestId === retryingRequestId && isResponseEntry(entry)) {
        const { chatCell } = createTimelineRow({ tone: "error" });
        chatCell.append(createThinkingIndicatorElement());
        continue;
      }

      appendMessage(entry.text, entry.role, {
        id: entry.id,
        persist: false,
        requestId: entry.requestId,
        timestamp: entry.timestamp,
        tone: getTimelineTone(entry),
      });
    }
  }

  async function restoreTimeline() {
    await renderTimeline();
  }

  async function appendInitialWelcomeMessage() {
    const canvas: CanvasInstruction[] = [
      {
        content: projectLogoMarkdown,
        title: "Oh My Graph!",
        type: "markdown",
      },
    ];
    const canvasGroup = await renderCanvasInstructions(canvas);

    appendAssistantResponse(
      'Hi, welcome to OMG! I can turn your Grafana Cloud metrics into ad-hoc visualizations: graphs, gauges, tables, heatmaps, alert lists, histograms, and timelines.\n\nAsk me things like "how are my hosts doing?", "show CPU and memory trends for the last hour", or "which services have the highest error rate?".\n\nI\'ll query Prometheus, show the evidence I used, and call out what\'s unknown instead of guessing.',
      canvasGroup,
      { canvas },
    );
  }

  async function resetTimeline() {
    timelineEntries = [];
    saveTimelineEntries(timelineEntries);
    await renderTimeline();
    await appendInitialWelcomeMessage();
  }

  async function submitChatMessage(message: string) {
    const requestId = createTimelineId("request");

    appendMessage(message, "user", { requestId });
    const memory = await loadChatMemoryStatus().catch(() => null);
    const activityIndicator = memory?.shouldCompress ? appendCompressingIndicator() : appendThinkingIndicator();

    try {
      const result = await sendChatMessage(message, (status) => activityIndicator?.updateStatus?.(status));
      activityIndicator?.row.remove();
      persistTimelineEntry({
        canvas: result.canvas,
        evidence: result.evidence,
        id: createTimelineId("entry"),
        requestId,
        role: "assistant",
        text: result.reply,
        timestamp: new Date().toISOString(),
      });
      await renderTimeline();
    } catch (error) {
      activityIndicator?.row.remove();
      persistTimelineEntry({
        id: createTimelineId("entry"),
        requestId,
        role: "system",
        text: error instanceof Error ? error.message : "Codex request failed",
        timestamp: new Date().toISOString(),
        tone: "error",
      });
      await renderTimeline();
    }
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeEvidenceModal();
    }
  });

  return {
    appendInitialWelcomeMessage,
    appendSystemError(text: string) {
      appendMessage(text, "system", { tone: "error" });
    },
    exportTimelineAsPdf,
    exportTimelineAsPng,
    hasEntries() {
      return timelineEntries.length > 0;
    },
    resetTimeline,
    restoreTimeline,
    submitChatMessage,
  };
}
