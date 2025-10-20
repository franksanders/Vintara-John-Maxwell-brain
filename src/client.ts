// Minimal client SDK to call the Brain API from frontend apps
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export class MaxwellBrainClient {
  constructor(private baseUrl: string, private apiKey?: string) {}

  private headers(extra?: Record<string, string>) {
    return {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
      ...(extra || {})
    };
  }

  async health() {
    const r = await fetch(`${this.baseUrl}/health`);
    return r.json();
  }

  async upsertProfile(profile: any) {
    const r = await fetch(`${this.baseUrl}/profile`, { method: 'POST', headers: this.headers(), body: JSON.stringify(profile) });
    if (!r.ok) throw new Error(`Profile error ${r.status}`);
    return r.json();
  }

  async startConversation(userId?: string, seed?: ChatMessage[]) {
    const r = await fetch(`${this.baseUrl}/conversation/start`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ userId, seed }) });
    if (!r.ok) throw new Error(`Start convo error ${r.status}`);
    return r.json();
  }

  async sendMessage(convoId: string, query: string, opts?: { topK?: number; temperature?: number; maxTokens?: number }) {
    const r = await fetch(`${this.baseUrl}/conversation/${convoId}/send`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ query, ...(opts || {}) }) });
    if (!r.ok) throw new Error(`Send error ${r.status}`);
    return r.json();
  }

  async stream(convoId: string, body: { query: string; topK?: number; temperature?: number; maxTokens?: number }, onToken: (t: string) => void): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/conversation/${convoId}/stream`, { method: 'POST', headers: this.headers({ Accept: 'text/event-stream' }), body: JSON.stringify(body) });
    if (!resp.body) throw new Error('No response body for SSE');
    const reader = (resp.body as any).getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        // Basic SSE parse: look for lines starting with 'data:'
        const dataLine = raw.split('\n').find(l => l.startsWith('data: '));
        if (!dataLine) continue;
        const payload = dataLine.slice(6);
        try {
          const evt = JSON.parse(payload);
          if (evt.token) onToken(evt.token);
        } catch {
          // non-JSON data; ignore
        }
      }
    }
  }

  async tts(text: string, format: 'mp3' | 'wav' | 'ogg' = 'mp3', parameters?: Record<string, any>) {
    const r = await fetch(`${this.baseUrl}/tts`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ text, format, parameters }) });
    if (!r.ok) throw new Error(`TTS error ${r.status}`);
    const blob = await r.blob();
    return blob;
  }
}
