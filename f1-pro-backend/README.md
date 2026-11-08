# SPORTSDASH F1 SignalR backend

Node.js service using `@microsoft/signalr` to connect to the unofficial F1 SignalR Core timing endpoint and subscribe to live topics.

## Start locally
```bash
cd f1-pro-backend
npm install
npm start
```
Open `http://localhost:8787/api/f1/health` and `/api/f1/snapshot`.

## Environment
Copy `.env.example` into your host's secret configuration (Node does not automatically load .env files). Configure `FRONTEND_ORIGIN`, and optionally `F1_TV_ACCESS_TOKEN` if obtained legitimately. Never commit tokens or cookies.

**Important:** This implements SignalR transport and timing-state normalization, but F1's unofficial endpoint, auth behavior, and message formats can change. Live connectivity and Pro-only telemetry have **not been validated**. `CarData.z` and `Position.z` are subscribed but are not decoded or exposed by this first implementation.

## API
- `GET /api/f1/health` connection status
- `GET /api/f1/snapshot` live classification in the SPORTSDASH schema

This public repository does not include F1 TV login automation. A Pro account does not confer a right to redistribute authenticated data. Restrict deployment to authorized personal use. If using `DASHBOARD_API_KEY`, the current public frontend does not support passing it; configure a private authenticated gateway rather than putting the key in client JavaScript.

## Hosting
GitHub Pages serves only the static frontend. Run this backend on a separate persistent Node.js host with WebSocket egress. GitHub Actions is not suitable for an always-on streaming connection.

The frontend can be pointed at the backend from its F1 tab. The F1 adapter falls back to OpenF1/Jolpica if the backend is unavailable.
