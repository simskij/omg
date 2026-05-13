```
                                 ██████╗ ██╗  ██╗    ███╗   ███╗██╗   ██╗
                                ██╔═══██╗██║  ██║    ████╗ ████║╚██╗ ██╔╝
                                ██║   ██║███████║    ██╔████╔██║ ╚████╔╝
                                ██║   ██║██╔══██║    ██║╚██╔╝██║  ╚██╔╝
                                ╚██████╔╝██║  ██║    ██║ ╚═╝ ██║   ██║
                                 ╚═════╝ ╚═╝  ╚═╝    ╚═╝     ╚═╝   ╚═╝

                              ██████╗ ██████╗  █████╗ ██████╗ ██╗  ██╗    ██╗
                             ██╔════╝ ██╔══██╗██╔══██╗██╔══██╗██║  ██║    ██║
                             ██║  ███╗██████╔╝███████║██████╔╝███████║    ██║
                             ██║   ██║██╔══██╗██╔══██║██╔═══╝ ██╔══██║    ╚═╝
                             ╚██████╔╝██║  ██║██║  ██║██║     ██║  ██║    ██╗
                              ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝    ╚═╝
```


<div align="center">
  Because dashboards suck! But graphs and visualizations do not!
</div>

---

<div align="center">
  Instead of modelling your data after situations you already know about;<br/>
  let's prepare visualization ad-hoc, based on what you're asking for!<br/><br/>It's gonna be fun - and useful!
</div>


## Getting started

Install dependencies:

```sh
bun install
```

Run the frontend and backend dev servers:

```sh
bun run dev
```

<br/>

## Showcase

<br/>

<div align="center">
  <img width="100%" alt="showcase" src="https://github.com/user-attachments/assets/f18adbb2-fad0-4b55-87a2-4be1efe01c1a" />
</div>

<br/>

## Configuration

### Codex Chat

The chat pane uses the official Codex package and SDK from the Bun server.

1. Start the app with `bun run dev`.
2. Click `Connect Codex` in the chat pane.
3. Open the displayed verification URL and enter the one-time code.
4. When Codex reports authenticated, send messages from the chat input.

Device auth requires device-code login to be enabled for your ChatGPT account or workspace. Codex stores the resulting session in its normal local auth cache, such as `~/.codex/auth.json` or your OS credential store.

### Grafana Cloud Metrics

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
