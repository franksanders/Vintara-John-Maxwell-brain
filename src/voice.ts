import axios from 'axios';
import { config } from './config';

export type AudioFormat = 'mp3' | 'wav' | 'flac' | 'ogg';

export async function synthesizeSpeech(text: string, format: AudioFormat = 'mp3', parametersOverride?: Record<string, any>): Promise<Buffer> {
  const token = config.voice.hf.apiToken;
  const model = config.voice.hf.ttsModel;
  if (!token || !model) throw new Error('HUGGINGFACE_API_TOKEN or HF_TTS_MODEL missing');
  // Build HF inference URL; encode owner and repo separately (do not encode the slash)
  const url = (() => {
    if (model.includes('/')) {
      const [owner, repo] = model.split('/');
      return `https://api-inference.huggingface.co/models/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    }
    return `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`;
  })();
  let payload: any = { inputs: text };
  // Merge env parameters with runtime overrides (runtime wins per-key)
  let baseParams: Record<string, any> | undefined;
  if (config.voice.hf.parameters) {
    try { baseParams = JSON.parse(config.voice.hf.parameters); } catch { /* ignore invalid JSON */ }
  }
  if (parametersOverride && typeof parametersOverride === 'object') {
    payload.parameters = { ...(baseParams || {}), ...parametersOverride };
  } else if (baseParams) {
    payload.parameters = baseParams;
  }
  try {
    const res = await axios.post(url, payload, {
      responseType: 'arraybuffer',
      headers: {
        Authorization: `Bearer ${token}`,
        // Some models return different audio types; accept anything binary
        Accept: '*/*'
      },
      timeout: 60000
    });
    return Buffer.from(res.data);
  } catch (e: any) {
    const status = e?.response?.status;
    // Retry without Authorization header in case public model + invalid token causes 401/403/404
    if (status === 401 || status === 403 || status === 404) {
      try {
        const resNoAuth = await axios.post(url, payload, {
          responseType: 'arraybuffer',
          headers: { Accept: '*/*' },
          timeout: 60000
        });
        return Buffer.from(resNoAuth.data);
      } catch { /* fall through to Space or throw */ }
    }
    // Fallback to a Space endpoint if provided (and possibly a different token)
    const space = config.voice.hf.endpoint;
    const altToken = config.voice.hf.altToken || token;
    if (space) {
      const r = await axios.post(space, payload, {
        responseType: 'arraybuffer',
        headers: { Authorization: `Bearer ${altToken}`, Accept: '*/*' },
        timeout: 60000
      });
      return Buffer.from(r.data);
    }
    throw e;
  }
}
