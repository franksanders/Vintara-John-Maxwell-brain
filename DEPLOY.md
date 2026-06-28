# Deployment Guide

## Prerequisites

- [OpenAI API key](https://platform.openai.com/api-keys)
- [Qdrant Cloud account](https://cloud.qdrant.io) (free tier: 1GB) **or** use Docker sidecar
- [Railway account](https://railway.app) or [Render account](https://render.com) (both have free tiers)

## Option 1: Railway (Recommended)

Railway supports Dockerfile deployments and can run Qdrant as a sidecar service.

### Step 1: Deploy Qdrant on Railway

1. In Railway, create a new project
2. Add service → Docker Image → `qdrant/qdrant`
3. Set volume mount: `/qdrant/storage`
4. Note the internal hostname (e.g. `qdrant.railway.internal:6333`)

### Step 2: Deploy Maxwell Brain

1. Connect your GitHub repo to Railway
2. Railway detects the `Dockerfile` automatically
3. Set environment variables (Settings → Variables):

```text
OPENAI_API_KEY=sk-...
EMBEDDING_PROVIDER=openai
VECTOR_DB=qdrant
QDRANT_URL=http://qdrant.railway.internal:6333
ADMIN_API_KEY=<generate a strong random key>
API_KEYS=<comma-separated client keys>
NODE_ENV=production
PORT=3000
PERSONA_PATH=./data/persona/john_persona_curated.md
CONVERSATION_STORE_PATH=./data/.cache/conversations.json
```

4. Deploy → the server auto-ingests transcripts on startup
5. Visit your Railway URL → you should see the coaching UI

### Step 3: Verify

```bash
curl https://your-app.railway.app/health
# → {"status":"ok","vector":"qdrant","embedding":"openai","voiceConfigured":false}

curl https://your-app.railway.app/corpus/stats -H "x-api-key: <your-api-key>"
# → {"stats":{"docs":490,"chunks":490},...}
```

---

## Option 2: Render.com

1. Fork/connect repo in Render dashboard
2. Render detects `render.yaml` automatically
3. Set sensitive env vars manually in the dashboard (OPENAI_API_KEY, QDRANT_URL, etc.)
4. For Qdrant: use [Qdrant Cloud](https://cloud.qdrant.io) free tier

---

## Option 3: Docker Compose (self-hosted / VPS)

```bash
git clone https://github.com/Vintaragroup/John-Maxwell-brain.git
cd John-Maxwell-brain
cp .env.example .env
# Edit .env — set OPENAI_API_KEY and other vars
docker compose up -d
# Visit http://your-server:3000
```

---

## Qdrant Cloud setup

1. Create account at [cloud.qdrant.io](https://cloud.qdrant.io)
2. Create a cluster (free tier: 1GB)
3. Copy the cluster URL and API key
4. Set in your deployment:
   ```
   QDRANT_URL=https://your-cluster.qdrant.io:6333
   QDRANT_API_KEY=your-qdrant-api-key
   ```

---

## Voice (TTS) — optional

To enable Maxwell's voice:

1. Get a free Hugging Face token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
2. Set in your deployment:
   ```
   HUGGINGFACE_API_TOKEN=hf_...
   HF_TTS_MODEL=parler-tts/parler-tts-large-v1
   HF_TTS_PARAMETERS={"description":"A warm, deep, authoritative male voice with Southern American accent speaks at a moderate, unhurried pace."}
   ```

---

## Re-ingesting after deployment

The server auto-ingests `data/transcripts/` on startup. For a fresh deployment with a new Qdrant instance, this happens automatically. To force a manual re-ingest:

```bash
curl -X POST https://your-app/admin/reingest \
  -H "x-api-key: <admin-key>"
```

Or restart the server (auto-ingest runs at startup).
