# SPORTSDASH — F1 TV Pro connector

The existing GitHub Pages site cannot maintain a private F1 SignalR connection. This directory documents the backend interface for a separately hosted, private service. **This is an integration scaffold, not an authenticated live connector.**

## Security
- Never commit F1 TV passwords, access tokens, cookies, or browser session exports.
- Keep authentication on a private backend, not in the static frontend.
- F1 TV Pro does not grant redistribution rights. Restrict any authenticated stream to permitted personal use.
- Do not expose an unauthenticated proxy of your F1 TV feed on the public internet.
- Review unofficial client compatibility and F1 terms before enabling access.

## Expected backend contract
GET /api/f1/snapshot?session_key=1234

Example JSON:
```json
{
  "session": {"session_key":1234,"session_name":"Qualifying"},
  "live":true,
  "entries":[{"number":1,"name":"VER","team":"Red Bull Racing","position":1,"gap":"0","interval":"0","lap":12,"lapTime":80.123,"tyre":"SOFT","stint":3}],
  "control":[],
  "errors":[]
}
```

The adapter must maintain the current state across SignalR delta messages, reconnect, and normalize race/qualifying/practice data. If car telemetry is available, use a separate authenticated endpoint rather than adding large arrays to every snapshot.

## Frontend
Set a private backend URL in the F1 tab. The URL is only held in page memory. OpenF1/Jolpica remain fallback sources. A backend with browser access must configure CORS appropriately and enforce its own access control.

## Deployment
GitHub Pages hosts only static files. Deploy the authenticated connector to a private always-on server or service that supports long-lived outbound WebSocket connections. GitHub Actions scheduled workflows are not a reliable replacement for a continuous live feed.
