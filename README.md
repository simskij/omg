# OMG Webapp

A minimal TypeScript webapp with a Tailwind/Vite frontend and a Bun backend.

## Development

Install dependencies:

```sh
bun install
```

Run the frontend and backend dev servers:

```sh
bun run dev
```

Vite serves the frontend on `http://localhost:5173` and proxies `/api` requests to the Bun backend on `http://localhost:3000`.

## Codex Chat

The chat pane uses the official Codex package and SDK from the Bun server.

1. Start the app with `bun run dev`.
2. Click `Connect Codex` in the chat pane.
3. Open the displayed verification URL and enter the one-time code.
4. When Codex reports authenticated, send messages from the chat input.

Device auth requires device-code login to be enabled for your ChatGPT account or workspace. Codex stores the resulting session in its normal local auth cache, such as `~/.codex/auth.json` or your OS credential store.

## Grafana Cloud Metrics

The Bun server can query Grafana Cloud metrics through the Prometheus HTTP API. Configure these environment variables before starting the server:

```sh
export GRAFANA_PROMETHEUS_URL="https://<your-prometheus-endpoint>/api/prom"
export GRAFANA_PROMETHEUS_USER="<grafana-cloud-instance-id>"
export GRAFANA_PROMETHEUS_TOKEN="<grafana-cloud-access-policy-token>"
```

Use the Prometheus endpoint from your Grafana Cloud stack details, not the Grafana UI URL. It usually looks like `https://prometheus-prod-<region>.grafana.net/api/prom`.

For Grafana Cloud Prometheus auth, use basic auth credentials from the metrics data source details:

`GRAFANA_PROMETHEUS_USER` is the metrics instance ID.

`GRAFANA_PROMETHEUS_TOKEN` is a Grafana Cloud access policy token with `metrics:read`. Grafana UI service-account tokens do not work for the hosted Prometheus endpoint.

`GRAFANA_PROMETHEUS_URL` can also point directly at an `/api/v1` Prometheus-compatible base URL, or a copied `/api/v1/query` URL. If no user is set, the server sends the token as a bearer token; Grafana Cloud commonly expects basic auth with the instance ID as the user and the token as the password.

Direct endpoints:

```sh
curl -X POST http://localhost:3000/api/grafana/prometheus/query \
  -H 'content-type: application/json' \
  -d '{"query":"up"}'

curl -X POST http://localhost:3000/api/grafana/prometheus/query_range \
  -H 'content-type: application/json' \
  -d '{"query":"up","start":"2026-05-13T11:00:00Z","end":"2026-05-13T12:00:00Z","step":"60s"}'

curl -X POST http://localhost:3000/api/grafana/prometheus/series \
  -H 'content-type: application/json' \
  -d '{"match":"up","start":"2026-05-13T11:00:00Z","end":"2026-05-13T12:00:00Z"}'

curl -X POST http://localhost:3000/api/grafana/prometheus/label_values \
  -H 'content-type: application/json' \
  -d '{"label":"__name__","start":"2026-05-13T11:00:00Z","end":"2026-05-13T12:00:00Z"}'

curl -X POST http://localhost:3000/api/grafana/prometheus/label_values \
  -H 'content-type: application/json' \
  -d '{"label":"__name__","match":"{__name__=~\".*(cpu|memory|mem|disk|filesystem|node|host).*\"}","start":"2026-05-13T11:00:00Z","end":"2026-05-13T12:00:00Z"}'
```

If an instant query such as `up` returns no series but you expect data, try a lookback query like `max_over_time(up[5m])` or use `/series` with `match: "up"` and a recent start/end window. Instant Prometheus queries only return currently active series at the evaluation timestamp.

The Codex chat endpoint can also ask Bun to run these Prometheus queries internally when a user asks for metrics or time-series data.

Codex can also instruct the frontend canvas to render metrics. `POST /api/chat` may return a `canvas` array with items like:

```json
[
  { "type": "single_stat", "label": "Healthy", "dataType": "bool", "value": true, "query": "max_over_time(up[5m])" },
  { "type": "single_stat", "label": "CPU", "dataType": "percentage", "value": 82.4, "query": "100 - avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100" },
  {
    "type": "graph",
    "title": "Requests",
    "categories": ["10:00", "10:01"],
    "query": "sum(rate(http_requests_total[1m]))",
    "series": [{ "name": "requests", "data": [12, 18] }]
  },
  {
    "type": "heatmap",
    "title": "Host Alerts",
    "columns": ["Disk", "Memory", "CPU"],
    "query": "ALERTS{alertstate=\"firing\"}",
    "rows": [
      { "label": "host-a", "values": ["ok", "warning", "ok"] },
      { "label": "host-b", "values": ["critical", "ok", "unknown"] }
    ]
  }
]
```

Panels with a `query` value render a hoverable info icon showing the PromQL that produced the panel.

For multi-host questions, Codex is instructed to combine aggregate and per-host views: aggregate single stats, per-host CPU/memory/disk graphs, host alert heatmaps when alert data is available, and a prose conclusion that calls out the most important risks.

Codex can chain multiple Grafana tool calls before answering. This lets it discover metric names and labels first, then run candidate PromQL queries instead of guessing node-exporter metric names.

Graph panels should be based on Prometheus range queries. When the user asks for utilization, trends, host health panels, diagrams, or time-series views and no time window is specified, Codex defaults to the last 1 hour with `step: "60s"`. Instant queries are reserved for single-stat snapshots such as current values, counts, and booleans.

Prometheus matrix results from `query_range` are mapped into canvas graphs by using sample timestamps as `categories`, series labels such as host/instance/device as `series[].name`, and numeric sample values as `series[].data`.

## Production

Build the frontend and backend:

```sh
bun run build
```

Start the Bun server:

```sh
bun run start
```

The production server serves `dist/client` and exposes `GET /api/health`, Codex auth routes under `/api/codex/auth/*`, Grafana Prometheus routes under `/api/grafana/prometheus/*`, and `POST /api/chat`.
