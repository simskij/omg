import { json, parseJson } from "./http";
import type { PrometheusQueryRequest } from "./types";
import { getString } from "./utils";

function grafanaConfig() {
  const baseUrl = getString(Bun.env.GRAFANA_PROMETHEUS_URL);
  const token = getString(Bun.env.GRAFANA_PROMETHEUS_TOKEN ?? Bun.env.GRAFANA_CLOUD_ACCESS_TOKEN);
  const user = getString(Bun.env.GRAFANA_PROMETHEUS_USER ?? Bun.env.GRAFANA_CLOUD_INSTANCE_ID);

  if (!baseUrl) {
    throw new Error("GRAFANA_PROMETHEUS_URL is required");
  }

  if (!token) {
    throw new Error("GRAFANA_PROMETHEUS_TOKEN is required");
  }

  return { baseUrl, token, user };
}

function prometheusApiUrl(pathname: string) {
  const { baseUrl } = grafanaConfig();
  const base = new URL(baseUrl);
  const basePath = base.pathname
    .replace(/\/+$/, "")
    .replace(/\/api\/v1\/(query|query_range)$/, "/api/v1");
  const apiBasePath = basePath.endsWith("/api/v1") ? basePath : `${basePath}/api/v1`;

  base.pathname = `${apiBasePath}${pathname}`.replace(/\/+/g, "/");
  base.search = "";

  return base;
}

function grafanaAuthHeaders() {
  const { token, user } = grafanaConfig();

  if (user) {
    return {
      authorization: `Basic ${btoa(`${user}:${token}`)}`,
    };
  }

  return {
    authorization: `Bearer ${token}`,
  };
}

async function grafanaPrometheusRequest(pathname: string, params: Record<string, string>) {
  const url = prometheusApiUrl(pathname);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: grafanaAuthHeaders(),
  });
  const body = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const bodyText = JSON.stringify(body);
    const authHint =
      response.status === 401
        ? " Grafana Cloud Prometheus requires basic auth with the metrics instance ID as GRAFANA_PROMETHEUS_USER and an access policy token with metrics:read as GRAFANA_PROMETHEUS_TOKEN. Grafana UI service-account tokens will not work for this endpoint."
        : "";

    throw new Error(`Grafana Prometheus returned ${response.status} for ${url.origin}${url.pathname}: ${bodyText}.${authHint}`);
  }

  return body;
}

export async function grafanaPrometheusSeries(request: PrometheusQueryRequest) {
  const match = getString(request.match);

  if (!match) {
    throw new Error("Prometheus series lookup requires match");
  }

  return grafanaPrometheusRequest("/series", {
    "match[]": match,
    start: getString(request.start),
    end: getString(request.end),
  });
}

export async function grafanaPrometheusLabelValues(request: PrometheusQueryRequest) {
  const label = getString(request.label);
  const match = getString(request.match);

  if (!label) {
    throw new Error("Prometheus label values lookup requires label");
  }

  return grafanaPrometheusRequest(`/label/${encodeURIComponent(label)}/values`, {
    "match[]": match,
    start: getString(request.start),
    end: getString(request.end),
  });
}

export async function grafanaPrometheusQuery(request: PrometheusQueryRequest) {
  const query = getString(request.query);

  if (!query) {
    throw new Error("Prometheus query is required");
  }

  return grafanaPrometheusRequest("/query", {
    query,
    time: getString(request.time),
  });
}

export async function grafanaPrometheusQueryRange(request: PrometheusQueryRequest) {
  const query = getString(request.query);
  const start = getString(request.start);
  const end = getString(request.end);
  const step = getString(request.step);

  if (!query || !start || !end || !step) {
    throw new Error("Prometheus range query requires query, start, end, and step");
  }

  return grafanaPrometheusRequest("/query_range", { query, start, end, step });
}

export async function handlePrometheusQuery(request: Request) {
  const body = await parseJson<PrometheusQueryRequest>(request);

  if (!body) {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    return json(await grafanaPrometheusQuery(body));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Prometheus query failed" }, { status: 500 });
  }
}

export async function handlePrometheusQueryRange(request: Request) {
  const body = await parseJson<PrometheusQueryRequest>(request);

  if (!body) {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    return json(await grafanaPrometheusQueryRange(body));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Prometheus range query failed" }, { status: 500 });
  }
}

export async function handlePrometheusSeries(request: Request) {
  const body = await parseJson<PrometheusQueryRequest>(request);

  if (!body) {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    return json(await grafanaPrometheusSeries(body));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Prometheus series lookup failed" }, { status: 500 });
  }
}

export async function handlePrometheusLabelValues(request: Request) {
  const body = await parseJson<PrometheusQueryRequest>(request);

  if (!body) {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    return json(await grafanaPrometheusLabelValues(body));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Prometheus label values lookup failed" }, { status: 500 });
  }
}
