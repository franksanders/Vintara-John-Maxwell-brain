Data layout
===========

- Place raw audio here under `wav/` (e.g., `data/wav`).
- Transcripts will be written to `data/transcripts` by the script, with optional `.json` sidecars.

Workflows
---------

1) Transcribe + ingest WAVs

   - Prereq: set OPENAI_API_KEY in your environment
   - Run:
     ts-node scripts/transcribe_and_ingest.ts data/wav http://localhost:3000 YOUR_API_KEY --copy-to-public

   - Flags:
     --copy-to-public  Copies WAVs to public/voices and sets audioUri for provenance
     --no-ingest       Only creates .txt/.json, does not ingest

2) Auto-ingest transcripts on startup

   - Set in .env:
     AUTO_INGEST_DIR=data/transcripts
   - Restart the server; it will auto-index all .txt in that folder (uses matching .json sidecars if present).
