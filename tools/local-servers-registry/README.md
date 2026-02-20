# Local Servers Registry (MVP)

Простой реестр локальных Bedrock-серверов для NocLauncher.

## Запуск

```bash
npm run registry:start
```

По умолчанию сервер стартует на `http://0.0.0.0:8787`.

## ENV

- `PORT` — порт (по умолчанию `8787`)
- `HOST` — интерфейс (по умолчанию `0.0.0.0`)
- `ROOM_TTL_MS` — TTL комнаты без heartbeat (по умолчанию `60000`)
- `MAX_ROOMS_PER_HOST` — лимит комнат на одного хоста (по умолчанию `3`)

Пример:

```bash
PORT=8787 ROOM_TTL_MS=90000 npm run registry:start
```

## API

- `GET /health`
- `GET /world/list`
- `POST /world/open`
- `POST /world/heartbeat`
- `POST /world/close`
- `POST /world/join-by-code`

## Подключение в лаунчере

В NocLauncher → **Локальные сервера** → вставь URL реестра, например:

`http://YOUR_SERVER_IP:8787`

Сохрани URL и обнови список.
