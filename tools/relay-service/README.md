# Noc Relay Service (MVP)

Control-plane + UDP relay skeleton for future full auto-relay mode.

## Start

```bash
node tools/relay-service/server.js
```

## ENV
- `RELAY_API_PORT` (default `8790`)
- `RELAY_UDP_PORT` (default `19140`)
- `RELAY_HOST` (default `0.0.0.0`)
- `RELAY_SESSION_TTL_MS` (default `120000`)

## API
- `GET /health`
- `POST /session/create` `{ roomId, publicRelayHost? }` -> `{ sessionId, hostToken, playerToken, relay }`
- `POST /session/bind` `{ sessionId, role: host|player, token, address, port }`
- `GET /session/status?sessionId=...`
- `POST /session/heartbeat` `{ sessionId }`
- `POST /session/close` `{ sessionId }`

This is a production-oriented foundation to integrate route selection and relay fallback in launcher.
