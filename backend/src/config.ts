import { z } from 'zod';

const liveKitEnvironmentSchema = z.object({
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
});

const agentEnvironmentSchema = liveKitEnvironmentSchema.extend({
  RIME_API_KEY: z.string().min(1),
  DEEPGRAM_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1).optional().default('ollama'),
});

const tokenServerEnvironmentSchema = liveKitEnvironmentSchema.extend({
  TOKEN_SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

export type AgentEnvironment = z.infer<typeof agentEnvironmentSchema>;
export type TokenServerEnvironment = z.infer<typeof tokenServerEnvironmentSchema>;

export function loadAgentEnvironment(environment: NodeJS.ProcessEnv = process.env): AgentEnvironment {
  return agentEnvironmentSchema.parse(environment);
}

export function loadTokenServerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): TokenServerEnvironment {
  return tokenServerEnvironmentSchema.parse(environment);
}

