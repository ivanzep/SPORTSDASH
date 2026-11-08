# Cloudflare F1 live timing: browser-session authentication

This is the Cloudflare backend for SPORTSDASH at `sportsdash-f1.zepivan.workers.dev`.

## Browser-only credentials

- SPORTSDASH requests **an F1 account bearer token**, never a password.
- The access token exists in the browser's JavaScript memory and is sent in the body of an HTTPS `POST /api/f1/start` request. It is retransmitted only if the current browser page needs to reconnect.
- The Worker passes the token to F1's unofficial SignalR Core negotiate and WebSocket endpoints. **The credential is never written to GitHub, Cloudflare Worker secrets, KV, D1, Durable Object storage, localStorage, or sessionStorage by this application.**
- Cloudflare processes the token in request/connection memory while negotiating the upstream socket. Cloudflare may have its own infrastructure/operational handling; this application does not claim that Cloudflare never handles it.
- A cryptographically random, 256-bit `X-Session-Key` isolates each browser's Durable Object. It is another bearer secret kept in browser memory.
- No global shared classification is exposed to other visitors. Requests without the correct ephemeral key cannot access the browser's timing session.
- The server sends periodic SignalR pings while the browser keeps its session alive. It disconnects and clears in-memory timing state after roughly 90 seconds without browser activity. If a process is restarted, in-memory state is lost and the browser must reconnect.
- There are **no Cloudflare Cron Triggers** for unattended F1 login. There are no F1 account secrets in Cloudflare's Worker secret list.

## How to use

1. Open the F1 tab in SPORTSDASH.
2. Confirm the endpoint is `https://sportsdash-f1.zepivan.workers.dev`.
3. Obtain an account bearer token through a legitimate F1 sign-in process you control. The site does not request a username or password and cannot perform F1's full login automatically.
4. Paste the temporary **access token**, not your password, into the F1 timing field, then click **Connect F1 timing**.
5. Use **Disconnect** to clear it from the page's JS memory and terminate the session. Refreshing or closing the page also loses the token. With no successful disconnect request, the server expires the session after inactivity.

**Token acquisition:** FastF1 (3.9+) includes F1 account authentication with browser or command-line sign-in, although its default local token cache is separate from SPORTSDASH and may persist tokens locally. See [FastF1](https://docs.fastf1.dev/) for the current supported sign-in options. SPORTSDASH intentionally does not automate unsupported Formula 1 login flows.

## Worker endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/f1/health` | Non-sensitive deployment health |
| POST | `/api/f1/start` | Start private feed connection; JSON body `{ "accessToken": "..." }` |
| GET | `/api/f1/heartbeat` | Renew the browser's in-memory session |
| GET | `/api/f1/snapshot` | Normalized timing/classification for this browser's session |
| POST | `/api/f1/disconnect` | Terminate the session and clear in-memory data |

All endpoints except health require `X-Session-Key: <64 hexadecimal characters>`. The UI creates this key automatically with the browser crypto API. Avoid placing it in URLs, logs or saved settings.

## Status and limitations

- The backend and dashboard integration have been committed and Cloudflare has accepted the script deployment.
- The real F1 SignalR upstream authentication and incoming timing data **have not been validated with an active user token or live session**.
- The upstream SignalR protocol is unofficial. It can change, and available feeds depend on account entitlements and session status.
- The current timing UI displays an F1 race-weekend card and a simplified leaderboard. High-frequency `CarData.z` and `Position.z` telemetry decompression is **not implemented**.
- GitHub Pages deploy status and public Cloudflare runtime response should be checked in a browser. Deployment acceptance does not establish functional live connectivity.
- No guarantees are made about Formula 1 terms of access. Use personally and in accordance with the applicable service terms.
