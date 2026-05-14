export type ClientElements = {
  authChallengeElement: HTMLDivElement | null;
  authCode: HTMLElement | null;
  authLink: HTMLAnchorElement | null;
  authNote: HTMLParagraphElement | null;
  chatForm: HTMLFormElement | null;
  chatInput: HTMLInputElement | null;
  connectCodexButton: HTMLButtonElement | null;
  exportPdfButton: HTMLButtonElement | null;
  exportPngButton: HTMLButtonElement | null;
  resetTimelineButton: HTMLButtonElement | null;
  resetTranscriptMemoryButton: HTMLButtonElement | null;
  sendButton: HTMLButtonElement | null;
  serviceStatusElement: HTMLDivElement | null;
  sharedScroll: HTMLDivElement | null;
  timeline: HTMLDivElement | null;
};

export function renderAppShell(app: HTMLDivElement): ClientElements {
  app.innerHTML = `
    <main class="h-dvh overflow-hidden bg-slate-950 text-slate-100">
      <section class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_480px]">
        <div class="hidden border-r border-white/10 bg-slate-900 lg:block"></div>

        <header class="border-b border-white/10 bg-slate-950 px-5 py-4">
            <div class="flex items-center justify-between gap-4">
              <div>
                <div class="flex items-center gap-2">
                  <h2 class="text-lg font-semibold">Chat</h2>
                  <div id="service-status" class="flex h-6 w-6 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-slate-400" role="status" aria-label="Checking services" title="Checking services">
                    <span class="h-2.5 w-2.5 animate-pulse rounded-full bg-current"></span>
                  </div>
                </div>
              </div>
              <div class="flex shrink-0 flex-wrap justify-end gap-2">
                <div class="group/export relative -mb-2 pb-2">
                  <button class="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-300/40" type="button" aria-label="Export options" title="Export options">
                    <svg aria-hidden="true" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 3v12" />
                      <path d="m7 10 5 5 5-5" />
                      <path d="M5 21h14" />
                    </svg>
                  </button>
                  <div class="absolute right-0 top-7 z-[9999] hidden w-40 rounded-2xl border border-white/10 bg-slate-950 p-2 shadow-2xl shadow-slate-950/60 group-hover/export:block group-focus-within/export:block">
                    <button id="export-png" class="block w-full rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50" type="button">
                      Export PNG
                    </button>
                    <button id="export-pdf" class="mt-1 block w-full rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50" type="button">
                      Export PDF
                    </button>
                  </div>
                </div>
                <div class="group/reset relative pb-2 -mb-2">
                  <button class="flex h-7 w-7 items-center justify-center rounded-full border border-rose-300/20 bg-rose-300/10 text-rose-100 transition hover:bg-rose-300/20 focus:outline-none focus:ring-2 focus:ring-rose-300/40" type="button" aria-label="Reset options" title="Reset options">
                    <svg aria-hidden="true" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 12a9 9 0 1 1-3-6.7" />
                      <path d="M21 3v6h-6" />
                    </svg>
                  </button>
                  <div class="absolute right-0 top-7 z-[9999] hidden w-56 rounded-2xl border border-white/10 bg-slate-950 p-2 shadow-2xl shadow-slate-950/60 group-hover/reset:block group-focus-within/reset:block">
                    <button id="reset-timeline" class="block w-full rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-200 transition hover:bg-white/10" type="button">
                      Reset transcript
                    </button>
                    <button id="reset-transcript-memory" class="mt-1 block w-full rounded-xl px-3 py-2 text-left text-xs font-medium text-rose-100 transition hover:bg-rose-300/10" type="button">
                      Reset transcript and memory
                    </button>
                  </div>
                </div>
                <button id="connect-codex" class="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-100 transition hover:bg-cyan-300/20" type="button">
                  Connect Codex
                </button>
              </div>
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
              <button id="send-button" class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cyan-300 text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400" type="submit" disabled aria-label="Send message" title="Send message">
                <svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m22 2-7 20-4-9-9-4Z" />
                  <path d="M22 2 11 13" />
                </svg>
              </button>
            </div>
        </form>
      </section>
    </main>
  `;

  return {
    authChallengeElement: document.querySelector<HTMLDivElement>("#auth-challenge"),
    authCode: document.querySelector<HTMLElement>("#auth-code"),
    authLink: document.querySelector<HTMLAnchorElement>("#auth-link"),
    authNote: document.querySelector<HTMLParagraphElement>("#auth-note"),
    chatForm: document.querySelector<HTMLFormElement>("#chat-form"),
    chatInput: document.querySelector<HTMLInputElement>("#chat-input"),
    connectCodexButton: document.querySelector<HTMLButtonElement>("#connect-codex"),
    exportPdfButton: document.querySelector<HTMLButtonElement>("#export-pdf"),
    exportPngButton: document.querySelector<HTMLButtonElement>("#export-png"),
    resetTimelineButton: document.querySelector<HTMLButtonElement>("#reset-timeline"),
    resetTranscriptMemoryButton: document.querySelector<HTMLButtonElement>("#reset-transcript-memory"),
    sendButton: document.querySelector<HTMLButtonElement>("#send-button"),
    serviceStatusElement: document.querySelector<HTMLDivElement>("#service-status"),
    sharedScroll: document.querySelector<HTMLDivElement>("#shared-scroll"),
    timeline: document.querySelector<HTMLDivElement>("#timeline"),
  };
}
