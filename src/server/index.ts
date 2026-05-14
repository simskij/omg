import { join, normalize } from "node:path";
import { codexLoginStatus, startCodexDeviceAuth } from "./codex-auth";
import { chatMemoryStatus, handleChat, handleChatStream, resetChatMemory } from "./chat";
import {
  handlePrometheusLabelValues,
  handlePrometheusQuery,
  handlePrometheusQueryRange,
  handlePrometheusSeries,
} from "./grafana";
import { createStaticHandler, json } from "./http";

const port = Number(Bun.env.PORT ?? 3000);
const clientDist = normalize(Bun.env.CLIENT_DIST ?? join(import.meta.dir, "../../dist/client"));
const serveStatic = createStaticHandler(clientDist);

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        status: "ok",
        runtime: "bun",
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/codex/auth/status") {
      return json(await codexLoginStatus());
    }

    if (url.pathname === "/api/codex/auth/start" && request.method === "POST") {
      try {
        return json({ challenge: await startCodexDeviceAuth() });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Unable to start Codex device auth" }, { status: 500 });
      }
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChat(request);
    }

    if (url.pathname === "/api/chat/stream" && request.method === "POST") {
      return handleChatStream(request);
    }

    if (url.pathname === "/api/chat/memory") {
      return json(chatMemoryStatus());
    }

    if (url.pathname === "/api/chat/memory/reset" && request.method === "POST") {
      return json({ memory: resetChatMemory() });
    }

    if (url.pathname === "/api/grafana/prometheus/query" && request.method === "POST") {
      return handlePrometheusQuery(request);
    }

    if (url.pathname === "/api/grafana/prometheus/query_range" && request.method === "POST") {
      return handlePrometheusQueryRange(request);
    }

    if (url.pathname === "/api/grafana/prometheus/series" && request.method === "POST") {
      return handlePrometheusSeries(request);
    }

    if (url.pathname === "/api/grafana/prometheus/label_values" && request.method === "POST") {
      return handlePrometheusLabelValues(request);
    }

    if (request.method === "GET" || request.method === "HEAD") {
      return serveStatic(url.pathname);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Server listening on http://localhost:${port}`);
