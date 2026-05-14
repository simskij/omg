type ServiceStatus = {
  bun: "checking" | "offline" | "online";
  codex: "authenticated" | "checking" | "error" | "unauthenticated";
};

export function createServiceStatusController(serviceStatusElement: HTMLDivElement | null) {
  let serviceStatus: ServiceStatus = { bun: "checking", codex: "checking" };

  function updateServiceStatus(status: Partial<ServiceStatus>) {
    serviceStatus = { ...serviceStatus, ...status };

    if (!serviceStatusElement) {
      return;
    }

    const bunLabel = serviceStatus.bun === "online" ? "Bun online" : serviceStatus.bun === "offline" ? "Bun offline" : "Bun checking";
    const codexLabel =
      serviceStatus.codex === "authenticated"
        ? "Codex authenticated"
        : serviceStatus.codex === "unauthenticated"
          ? "Codex not authenticated"
          : serviceStatus.codex === "error"
            ? "Codex status unavailable"
            : "Codex checking";
    const label = `${bunLabel}; ${codexLabel}`;
    const healthy = serviceStatus.bun === "online" && serviceStatus.codex === "authenticated";
    const warning = serviceStatus.bun === "online" && serviceStatus.codex === "unauthenticated";
    const checking = serviceStatus.bun === "checking" || serviceStatus.codex === "checking";

    serviceStatusElement.className = healthy
      ? "flex h-6 w-6 items-center justify-center rounded-full border border-emerald-300/30 bg-emerald-300/10 text-emerald-200 shadow-[0_0_20px_rgba(52,211,153,0.2)]"
      : warning
        ? "flex h-6 w-6 items-center justify-center rounded-full border border-amber-300/30 bg-amber-300/10 text-amber-200"
        : checking
          ? "flex h-6 w-6 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-slate-400"
          : "flex h-6 w-6 items-center justify-center rounded-full border border-rose-300/30 bg-rose-300/10 text-rose-200";
    serviceStatusElement.innerHTML = `<span class="h-2.5 w-2.5 ${checking ? "animate-pulse" : ""} rounded-full bg-current"></span>`;
    serviceStatusElement.setAttribute("aria-label", label);
    serviceStatusElement.title = label;
  }

  return { updateServiceStatus };
}
