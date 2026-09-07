import { describe, expect, it } from 'vitest';

import { loadAgentEnvironment, loadTokenServerEnvironment } from '../src/config.js';

const liveKitEnvironment = {
  LIVEKIT_URL: 'wss://voiceflow.example.livekit.cloud',
  LIVEKIT_API_KEY: 'api-key',
  LIVEKIT_API_SECRET: 'api-secret',
};

describe('environment validation', () => {
  it('accepts a complete agent environment', () => {
    expect(
      loadAgentEnvironment({
        ...liveKitEnvironment,
        RIME_API_KEY: 'rime-key',
        DEEPGRAM_API_KEY: 'deepgram-key',
        OPENAI_API_KEY: 'openai-key',
      }),
    ).toMatchObject(liveKitEnvironment);
  });

  it('defaults the token server port', () => {
    expect(loadTokenServerEnvironment(liveKitEnvironment).TOKEN_SERVER_PORT).toBe(3001);
  });
});

