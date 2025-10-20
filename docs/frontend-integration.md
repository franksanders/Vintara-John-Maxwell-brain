# Frontend Integration Guide

This guide shows how to connect your frontend to the Maxwell Coach Brain API and Hugging Face TTS.

## Quick options

- OpenAPI spec: `docs/openapi.yaml` (import into Postman/Insomnia or generate clients)
- Minimal client: `src/client.ts` (fetch-based wrapper for chat, SSE, and TTS)

## CORS & API keys

Set `CORS_ORIGINS` in `.env` to your dev and deployed origins, e.g.

```
CORS_ORIGINS=http://localhost:5173,https://<your-ngrok>.ngrok.io
```

Provide an API key to your frontend via an environment-config or session store. The API expects an `x-api-key` header if `API_KEYS` is set; when empty, dev mode allows unauthenticated requests.

## Typical flow

1) Upsert profile (optional but recommended)
2) Start conversation → get `{ id, openingMessage }`
3) Send messages with `/conversation/:id/send` (JSON) or `/conversation/:id/stream` (SSE)
4) For voice, call `/tts` with returned text or `/generate/voice` directly

## Example usage (React)

```ts
import { useMemo } from 'react';
import { MaxwellBrainClient } from '../src/client';

const client = new MaxwellBrainClient(import.meta.env.VITE_BRAIN_URL, import.meta.env.VITE_BRAIN_KEY);

async function start() {
  const { id, openingMessage } = await client.startConversation();
  // render openingMessage and keep id
}

async function send(convoId: string, text: string) {
  const res = await client.sendMessage(convoId, text);
  // render res.answer, citations, etc.
}

async function speak(text: string) {
  const blob = await client.tts(text, 'mp3');
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.play();
}
```

## Streaming via SSE

The app exposes `text/event-stream` endpoints. If your framework can’t open EventSource to a POST, use a GET URL with a server-side session token or proxy. Alternatively, use the JSON `/send` endpoint and render when complete.

## Troubleshooting

- 401/403: Check `x-api-key` vs `API_KEYS` and `ADMIN_API_KEY`
- CORS error: Add your origin to `CORS_ORIGINS` and restart
- TTS 5xx: Confirm `HUGGINGFACE_API_TOKEN` and `HF_TTS_MODEL`
