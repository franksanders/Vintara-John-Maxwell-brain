describe('generateAnswer (stub)', () => {
  let generateAnswer: any;
  let originalKey: string | undefined;

  beforeAll(() => {
    originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY; // ensure env cleared before module import
    jest.resetModules();
    // Mock config to guarantee no key even if process.env changes
    jest.mock('../src/config', () => ({
      config: {
        embedding: { openaiApiKey: undefined },
        chat: { model: 'gpt-4o-mini' }
      }
    }));
    generateAnswer = require('../src/generate').generateAnswer;
  });

  afterAll(() => {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  });

  it('returns stub answer when no API key', async () => {
    const prompt = {
      system: 'System prompt',
      user: 'How do I grow as a leader?',
      context: '[#1 score=0.9] Leadership is influence.'
    };
    const result = await generateAnswer(prompt, { temperature: 0.5, maxTokens: 50 });
    expect(result.model).toBe('stub-local');
    expect(result.answer).toContain('Leadership Insight');
    expect(result.citations.length).toBeGreaterThan(0);
  });
});
