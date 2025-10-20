# Frontend review checklist

Use this list when you share your frontend for wiring with the Brain API and TTS.

- Project type and version
  - [ ] Framework (Vite, Next.js, Expo, React Native, vanilla)
  - [ ] Node and package manager versions
  - [ ] Dev server origin (e.g., http://localhost:5173)
- Auth and config
  - [ ] Where do you store API base URL and API key?
  - [ ] Secure handling of `x-api-key` (never commit real keys)
  - [ ] CORS origin added to backend `.env` (CORS_ORIGINS)
- Chat integration
  - [ ] Calls `/conversation/start` and persists `{ id }`
  - [ ] Sends messages to `/conversation/:id/send` or streams `/conversation/:id/stream`
  - [ ] Renders assistant text incrementally (SSE) or after completion
  - [ ] Displays citations/links when present
- Profile
  - [ ] Captures first name, location/locale, optional role/tone/brevity
  - [ ] Saves to `/profile` with userId
- Voice
  - [ ] Uses `/tts` or `/generate/voice`
  - [ ] Plays returned audio correctly (mp3/wav)
  - [ ] Optional speaker_wav selection
- Error handling
  - [ ] 401/403 surfaced to user (invalid key)
  - [ ] 429 retry with backoff
  - [ ] Network/CORS issues surfaced, with retry
- Mobile and accessibility
  - [ ] Mobile-first layout and safe area
  - [ ] Tap targets and readable font sizes
  - [ ] Keyboard focus states
- Observability
  - [ ] Health and corpus stats visible in a dev panel
  - [ ] Basic logging for request timing and failures
