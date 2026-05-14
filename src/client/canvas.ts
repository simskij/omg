import type {
  CanvasAlertListInstruction,
  CanvasBarInstruction,
  CanvasEventTimelineInstruction,
  CanvasGaugeInstruction,
  CanvasGraphInstruction,
  CanvasHeatmapInstruction,
  CanvasHistogramInstruction,
  CanvasInstruction,
  CanvasMarkdownInstruction,
  CanvasSingleStatInstruction,
  CanvasStackedTimeseriesInstruction,
  CanvasTableInstruction,
  SingleStatProps,
} from "./types";

let charts: Array<{ destroy: () => void }> = [];

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
  parent.classList.add("relative", "z-0", "hover:z-[9000]", "focus-within:z-[9000]");

  const header = document.createElement("div");
  header.className = "mb-3 flex items-start justify-between gap-3";

  const heading = document.createElement("h2");
  heading.className = "text-xs font-medium uppercase tracking-[0.2em] text-slate-400";
  heading.textContent = title;
  header.append(heading);

  if (query) {
    const info = document.createElement("div");
    info.className = "group relative z-[9998] shrink-0";
    info.innerHTML = `
      <button class="flex h-6 w-6 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-xs font-semibold text-cyan-100" type="button" aria-label="Show PromQL query">i</button>
      <div class="pointer-events-none absolute right-0 top-8 z-[9999] hidden w-80 max-w-[70vw] rounded-2xl border border-white/10 bg-slate-950 p-3 text-left text-xs normal-case tracking-normal text-slate-200 shadow-2xl shadow-slate-950/60 group-hover:block">
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

function isStackedTimeseriesInstruction(value: CanvasInstruction): value is CanvasStackedTimeseriesInstruction {
  return value.type === "stacked_timeseries";
}

function isTableInstruction(value: CanvasInstruction): value is CanvasTableInstruction {
  return value.type === "table";
}

function isBarInstruction(value: CanvasInstruction): value is CanvasBarInstruction {
  return value.type === "bar";
}

function isGaugeInstruction(value: CanvasInstruction): value is CanvasGaugeInstruction {
  return value.type === "gauge";
}

function isHeatmapInstruction(value: CanvasInstruction): value is CanvasHeatmapInstruction {
  return value.type === "heatmap";
}

function isAlertListInstruction(value: CanvasInstruction): value is CanvasAlertListInstruction {
  return value.type === "alert_list";
}

function isHistogramInstruction(value: CanvasInstruction): value is CanvasHistogramInstruction {
  return value.type === "histogram";
}

function isEventTimelineInstruction(value: CanvasInstruction): value is CanvasEventTimelineInstruction {
  return value.type === "event_timeline";
}

function isMarkdownInstruction(value: CanvasInstruction): value is CanvasMarkdownInstruction {
  return value.type === "markdown";
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

function formatPanelValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  }

  return value;
}

function trimCommonIndent(value: string) {
  const lines = value.replace(/\n$/, "").split("\n");
  const indents = lines.flatMap((line) => {
    if (!line.trim()) {
      return [];
    }

    return [line.match(/^ */)?.[0].length ?? 0];
  });
  const indent = Math.min(...indents, Infinity);

  return Number.isFinite(indent) && indent > 0 ? lines.map((line) => line.slice(indent)).join("\n") : lines.join("\n");
}

function createTablePanel(instruction: CanvasTableInstruction) {
  const card = document.createElement("section");
  card.className = "rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-2xl shadow-cyan-950/20 backdrop-blur";

  const scroll = document.createElement("div");
  scroll.className = "overflow-x-auto";

  const table = document.createElement("table");
  table.className = "min-w-full divide-y divide-white/10 text-sm";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  for (const column of instruction.columns) {
    const header = document.createElement("th");
    header.className = "px-3 py-2 text-left text-xs font-medium uppercase tracking-[0.16em] text-slate-400 first:pl-0";
    header.textContent = column;
    headerRow.append(header);
  }

  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  tbody.className = "divide-y divide-white/5";

  for (const row of instruction.rows) {
    const tr = document.createElement("tr");

    for (const value of row) {
      const td = document.createElement("td");
      td.className = "whitespace-nowrap px-3 py-2 text-slate-200 first:pl-0";
      td.textContent = formatPanelValue(value);
      tr.append(td);
    }

    tbody.append(tr);
  }

  table.append(tbody);
  appendPanelHeader(card, instruction.title, instruction.query);
  scroll.append(table);
  card.append(scroll);
  return card;
}

type ChartPanelOptions = {
  categories?: string[];
  chartType?: "area" | "bar";
  query?: string;
  series: Array<{ data: unknown[]; name: string }>;
  stacked?: boolean;
  title: string;
  unit?: string;
  yAxisTitle?: string;
};

function normalizeChartPanelData(instruction: ChartPanelOptions) {
  const categories = [...(instruction.categories ?? [])];
  const series = instruction.series.map((candidate) => ({
    name: candidate.name,
    data: candidate.data.map((point, index) => {
      let y: unknown = point;

      if (Array.isArray(point)) {
        if (!categories[index] && point[0] !== undefined) {
          categories[index] = formatPanelValue(point[0] as string | number | boolean | null);
        }

        y = point[1];
      } else if (point && typeof point === "object") {
        const objectPoint = point as { x?: unknown; y?: unknown };

        if (!categories[index] && objectPoint.x !== undefined) {
          categories[index] = formatPanelValue(objectPoint.x as string | number | boolean | null);
        }

        y = objectPoint.y;
      }

      const value = Number(y ?? 0);

      return Number.isFinite(value) ? value : null;
    }),
  }));

  return { categories: categories.length > 0 ? categories : undefined, series };
}

function appendChartPanel(parent: HTMLElement, instruction: ChartPanelOptions) {
  const card = document.createElement("section");
  card.className = "rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-2xl shadow-cyan-950/20 backdrop-blur";

  const graph = document.createElement("div");
  appendPanelHeader(card, instruction.title, instruction.query);
  card.append(graph);
  parent.append(card);

  window.requestAnimationFrame(() => {
    void import("apexcharts").then(({ default: ApexCharts }) => {
      if (!graph.isConnected) {
        return;
      }

      const chartType = instruction.chartType ?? "area";
      const isBar = chartType === "bar";
      const normalized = normalizeChartPanelData(instruction);
      const categoryCount = Math.max(normalized.categories?.length ?? 0, 1);
      const height = isBar ? Math.max(300, categoryCount * Math.max(normalized.series.length, 1) * 34 + 120) : 288;
      const yaxis = {
        labels: {
          formatter: (value: number) => `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${instruction.unit ?? ""}`,
          style: { colors: "#94a3b8" },
        },
        ...(instruction.yAxisTitle ? { title: { style: { color: "#94a3b8" }, text: instruction.yAxisTitle } } : {}),
      };

      const chart = new ApexCharts(graph, {
        chart: {
          background: "transparent",
          fontFamily: "inherit",
          height,
          stacked: instruction.stacked,
          toolbar: { show: false },
          type: chartType,
        },
        colors: ["#E41A1C", "#377EB8", "#4DAF4A", "#FF7F00", "#FFFF33", "#A65628", "#F781BF", "#999999"],
        dataLabels: { enabled: false },
        fill: isBar
          ? { opacity: 0.85, type: "solid" }
          : {
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
          fontSize: "12px",
          labels: { colors: "#cbd5e1" },
          markers: { size: 5 },
        },
        markers: {
          size: isBar ? 0 : 3,
          strokeWidth: 0,
        },
        plotOptions: {
          bar: {
            barHeight: "38%",
            borderRadius: 5,
            borderRadiusApplication: "end",
            horizontal: true,
          },
        },
        series: normalized.series,
        stroke: {
          curve: "smooth",
          colors: isBar ? ["#020617"] : undefined,
          width: isBar ? 2 : 3,
        },
        theme: { mode: "dark" },
        tooltip: {
          theme: "dark",
          y: {
            formatter: (value: number) => `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })}${instruction.unit ?? ""}`,
          },
        },
        xaxis: {
          axisBorder: { show: false },
          axisTicks: { show: false },
          categories: normalized.categories,
          labels: { style: { colors: "#94a3b8" } },
        },
        yaxis,
      });

      void chart.render().then(() => window.dispatchEvent(new Event("resize")));
      charts.push(chart);
    });
  });

  return card;
}

function appendGraphPanel(parent: HTMLElement, instruction: CanvasGraphInstruction) {
  return appendChartPanel(parent, instruction);
}

function appendStackedTimeseriesPanel(parent: HTMLElement, instruction: CanvasStackedTimeseriesInstruction) {
  return appendChartPanel(parent, { ...instruction, stacked: true });
}

function appendBarPanel(parent: HTMLElement, instruction: CanvasBarInstruction) {
  return appendChartPanel(parent, { ...instruction, chartType: "bar" });
}

function appendHistogramPanel(parent: HTMLElement, instruction: CanvasHistogramInstruction) {
  return appendChartPanel(parent, {
    categories: instruction.buckets.map((bucket) => bucket.label),
    chartType: "bar",
    query: instruction.query,
    series: [{ data: instruction.buckets.map((bucket) => bucket.value), name: instruction.unit ?? "count" }],
    title: instruction.title,
    unit: instruction.unit,
  });
}

function severityClass(value?: string) {
  if (value === "critical") {
    return "border-rose-300/30 bg-rose-300/10 text-rose-100";
  }

  if (value === "warning") {
    return "border-amber-300/30 bg-amber-300/10 text-amber-100";
  }

  if (value === "ok") {
    return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
  }

  return "border-slate-300/20 bg-slate-300/10 text-slate-200";
}

function createGaugePanel(instruction: CanvasGaugeInstruction) {
  const card = document.createElement("section");
  card.className = "rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-2xl shadow-cyan-950/20 backdrop-blur";

  const min = instruction.min ?? 0;
  const max = instruction.max ?? 100;
  const range = max - min || 1;
  const percentage = Math.max(0, Math.min(100, ((instruction.value - min) / range) * 100));
  const warning = instruction.thresholds?.warning;
  const critical = instruction.thresholds?.critical;
  const tone = critical !== undefined && instruction.value >= critical ? "critical" : warning !== undefined && instruction.value >= warning ? "warning" : "ok";

  const value = document.createElement("p");
  value.className = "mt-3 text-4xl font-semibold tracking-tight text-white";
  value.textContent = `${instruction.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${instruction.unit ?? ""}`;

  const label = document.createElement("p");
  label.className = "mt-1 text-sm text-slate-400";
  label.textContent = instruction.label ?? `${min}${instruction.unit ?? ""} to ${max}${instruction.unit ?? ""}`;

  const track = document.createElement("div");
  track.className = "mt-5 h-3 overflow-hidden rounded-full bg-slate-800";

  const fill = document.createElement("div");
  fill.className = `h-full rounded-full ${tone === "critical" ? "bg-rose-400" : tone === "warning" ? "bg-amber-300" : "bg-emerald-300"}`;
  fill.style.width = `${percentage}%`;
  track.append(fill);

  appendPanelHeader(card, instruction.title, instruction.query);
  card.append(value, label, track);
  return card;
}

function createAlertListPanel(instruction: CanvasAlertListInstruction) {
  const card = document.createElement("section");
  card.className = "rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-2xl shadow-cyan-950/20 backdrop-blur";

  const list = document.createElement("div");
  list.className = "flex flex-col gap-3";

  for (const alert of instruction.alerts) {
    const item = document.createElement("article");
    item.className = "rounded-xl border border-white/10 bg-white/[0.03] p-3";

    const header = document.createElement("div");
    header.className = "flex flex-wrap items-start justify-between gap-2";

    const title = document.createElement("h3");
    title.className = "font-medium text-slate-100";
    title.textContent = alert.name;

    const badge = document.createElement("span");
    badge.className = `rounded-full border px-2 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${severityClass(alert.severity)}`;
    badge.textContent = alert.severity ?? alert.state ?? "unknown";
    header.append(title, badge);
    item.append(header);

    const details = [alert.target, alert.state, alert.startsAt].filter(Boolean).join(" | ");

    if (details) {
      const meta = document.createElement("p");
      meta.className = "mt-2 text-xs text-slate-500";
      meta.textContent = details;
      item.append(meta);
    }

    if (alert.summary) {
      const summary = document.createElement("p");
      summary.className = "mt-2 text-sm text-slate-300";
      summary.textContent = alert.summary;
      item.append(summary);
    }

    list.append(item);
  }

  appendPanelHeader(card, instruction.title, instruction.query);
  card.append(list);
  return card;
}

function createEventTimelinePanel(instruction: CanvasEventTimelineInstruction) {
  const card = document.createElement("section");
  card.className = "rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-2xl shadow-cyan-950/20 backdrop-blur";

  const list = document.createElement("div");
  list.className = "relative flex flex-col gap-4 before:absolute before:left-2 before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-white/10";

  for (const event of instruction.events) {
    const item = document.createElement("article");
    item.className = "relative pl-7";

    const marker = document.createElement("div");
    marker.className = `absolute left-0 top-1 h-4 w-4 rounded-full border ${severityClass(event.severity)}`;

    const title = document.createElement("h3");
    title.className = "font-medium text-slate-100";
    title.textContent = event.title;

    const time = document.createElement("p");
    time.className = "mt-1 text-xs text-slate-500";
    time.textContent = event.time;

    item.append(marker, title, time);

    if (event.description) {
      const description = document.createElement("p");
      description.className = "mt-2 text-sm text-slate-300";
      description.textContent = event.description;
      item.append(description);
    }

    list.append(item);
  }

  appendPanelHeader(card, instruction.title, instruction.query);
  card.append(list);
  return card;
}

function createMarkdownPanel(instruction: CanvasMarkdownInstruction) {
  const card = document.createElement("section");
  card.className = "rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-2xl shadow-cyan-950/20 backdrop-blur";

  if (instruction.title) {
    appendPanelHeader(card, instruction.title);
  }

  const content = document.createElement("div");
  content.className = "space-y-3 text-sm leading-6 text-slate-200";

  const fencePattern = /```(?:\w+)?\n([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(instruction.content))) {
    const text = instruction.content.slice(cursor, match.index).trim();

    if (text) {
      const paragraph = document.createElement("p");
      paragraph.className = "whitespace-pre-wrap";
      paragraph.textContent = text;
      content.append(paragraph);
    }

    const pre = document.createElement("pre");
    pre.className = "flex justify-center overflow-x-auto rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-cyan-100 leading-none";

    const code = document.createElement("code");
    code.className = "inline-block text-left font-mono text-xs leading-none";
    code.textContent = `\n${trimCommonIndent(match[1] ?? "")}\n`;
    pre.append(code);
    content.append(pre);

    cursor = fencePattern.lastIndex;
  }

  const remaining = instruction.content.slice(cursor).trim();

  if (remaining || content.childElementCount === 0) {
    const paragraph = document.createElement("p");
    paragraph.className = "whitespace-pre-wrap";
    paragraph.textContent = remaining || instruction.content;
    content.append(paragraph);
  }

  card.append(content);

  return card;
}

function createHeatmapPanel(instruction: CanvasHeatmapInstruction) {
  const card = document.createElement("section");
  card.className = "rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-2xl shadow-cyan-950/20 backdrop-blur";

  const scroll = document.createElement("div");
  scroll.className = "overflow-x-auto";

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
  scroll.append(table);
  card.append(scroll);
  return card;
}

export async function renderCanvasInstructions(instructions: CanvasInstruction[]) {
  const group = document.createElement("section");
  group.className = "flex flex-col gap-4 border-b border-dashed border-slate-500/40 pb-6 last:border-b-0";

  const stats = instructions.filter(isSingleStatInstruction);
  const graphs = instructions.filter(isGraphInstruction);
  const stackedTimeseries = instructions.filter(isStackedTimeseriesInstruction);
  const bars = instructions.filter(isBarInstruction);
  const gauges = instructions.filter(isGaugeInstruction);
  const tables = instructions.filter(isTableInstruction);
  const heatmaps = instructions.filter(isHeatmapInstruction);
  const alertLists = instructions.filter(isAlertListInstruction);
  const histograms = instructions.filter(isHistogramInstruction);
  const eventTimelines = instructions.filter(isEventTimelineInstruction);
  const markdowns = instructions.filter(isMarkdownInstruction);

  if (stats.length > 0) {
    group.append(createSingleStatsGroup(stats));
  }

  for (const graph of graphs) {
    appendGraphPanel(group, graph);
  }

  for (const graph of stackedTimeseries) {
    appendStackedTimeseriesPanel(group, graph);
  }

  for (const bar of bars) {
    appendBarPanel(group, bar);
  }

  for (const gauge of gauges) {
    group.append(createGaugePanel(gauge));
  }

  for (const histogram of histograms) {
    appendHistogramPanel(group, histogram);
  }

  for (const table of tables) {
    group.append(createTablePanel(table));
  }

  for (const heatmap of heatmaps) {
    group.append(createHeatmapPanel(heatmap));
  }

  for (const alertList of alertLists) {
    group.append(createAlertListPanel(alertList));
  }

  for (const eventTimeline of eventTimelines) {
    group.append(createEventTimelinePanel(eventTimeline));
  }

  for (const markdown of markdowns) {
    group.append(createMarkdownPanel(markdown));
  }

  return group;
}

export function destroyCharts() {
  for (const chart of charts) {
    chart.destroy();
  }

  charts = [];
}
