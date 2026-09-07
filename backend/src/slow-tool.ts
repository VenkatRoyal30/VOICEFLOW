import { llm } from '@livekit/agents';
import { z } from 'zod';

import { type GenerationCoordinator } from './coordinator.js';
import { logger } from './logger.js';

export interface SlowToolParams {
  generationId: number;
  query: string;
  delayMs?: number | null;
}

export interface SlowToolResult {
  generationId: number;
  query: string;
  processedItems: number;
  summary: string;
  status: 'completed';
}

export class ToolAbortError extends Error {
  readonly generationId: number;

  constructor(generationId: number, reason?: string) {
    super(`Tool operation aborted for generation ${generationId}${reason ? `: ${reason}` : ''}`);
    this.name = 'ToolAbortError';
    this.generationId = generationId;
  }
}

export function isToolAbortError(error: unknown): error is ToolAbortError {
  return error instanceof ToolAbortError;
}

/**
 * Deterministic long-running operation for demonstrating VoiceFlow tool execution.
 * Respects the provided AbortSignal and aborts immediately with ToolAbortError.
 */
export async function runCancellableSlowTool(
  params: SlowToolParams,
  signal?: AbortSignal,
): Promise<SlowToolResult> {
  const { generationId, query } = params;
  const delayMs = params.delayMs ?? 50;

  if (signal?.aborted) {
    throw new ToolAbortError(generationId, String(signal.reason ?? 'aborted'));
  }

  return new Promise<SlowToolResult>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onAbort = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      signal?.removeEventListener('abort', onAbort);
      reject(new ToolAbortError(generationId, String(signal?.reason ?? 'aborted')));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve({
        generationId,
        query,
        processedItems: query.length * 7,
        summary: `Computed result for query "${query}" under generation ${generationId}`,
        status: 'completed',
      });
    }, delayMs);
  });
}

export const slowAnalysisParameters = z.object({
  query: z.string().describe('The topic, dataset, or query to analyze'),
  delayMs: z.preprocess(
    (val) => {
      if (val === null || val === undefined || val === '' || val === 'null' || val === 'default') {
        return null;
      }
      if (typeof val === 'number') {
        return Number.isFinite(val) ? val : null;
      }
      if (typeof val === 'string') {
        const trimmed = val.trim();
        const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s)?$/i);
        if (match) {
          const base = Number(match[1]);
          const unit = match[2]?.toLowerCase();
          const num = unit === 's' ? base * 1000 : base;
          return Number.isFinite(num) ? num : val;
        }
      }
      return val;
    },
    z.number().nullable().describe('Deterministic processing delay in milliseconds, or null for default'),
  ),
});

/**
 * Creates a LiveKit cancellable FunctionTool wired to the VoiceFlow GenerationCoordinator.
 * Honors both LiveKit's abortSignal and the VoiceFlow generation signal via AbortSignal.any.
 * Validates the result against the fence before returning.
 */
export function createSlowAnalysisTool(coordinator: GenerationCoordinator) {
  return llm.tool({
    name: 'slow_analysis',
    description: 'Performs heavy, long-running computation or analysis for a specific query.',
    parameters: slowAnalysisParameters,
    flags: llm.ToolFlag.CANCELLABLE,
    execute: async ({ query, delayMs }, { abortSignal }) => {
      let generationId = coordinator.getActiveGenerationId();
      if (generationId === null) {
        const fallback = coordinator.startGeneration({ query, source: 'tool_fallback' });
        generationId = fallback.id;
      } else if (!coordinator.isCurrentGeneration(generationId)) {
        logger.warn({ generationId }, 'Tool execution rejected: no valid active generation');
        return 'Analysis cancelled: superseded by newer request.';
      }

      coordinator.transitionState('TOOL_RUNNING', { generationId, query });
      logger.info(
        { generationId, query },
        `[TURN] LLM/TOOL: Slow analysis tool running for generation #${generationId}`,
      );

      const coordinatorSignal = coordinator.getSignal(generationId);
      const combinedSignal = coordinatorSignal
        ? AbortSignal.any([abortSignal, coordinatorSignal])
        : abortSignal;

      try {
        const rawResult = await runCancellableSlowTool(
          { generationId, query, delayMs: delayMs ?? 1000 },
          combinedSignal,
        );

        const fence = coordinator.fenceResult(generationId, rawResult);
        if (!fence.accepted) {
          logger.warn(
            { generationId, reason: fence.reason },
            'Tool result discarded by VoiceFlow fence: will not reach Rime TTS',
          );
          return 'Analysis cancelled: superseded by newer request.';
        }

        logger.info(
          { generationId },
          `[TURN] RESULT_ACCEPTED: Tool result accepted and verified for generation #${generationId}`,
        );

        return fence.data.summary;
      } catch (error) {
        if (isToolAbortError(error) || (error instanceof Error && error.name === 'AbortError')) {
          coordinator.transitionState('RESULT_DISCARDED', {
            generationId,
            reason: 'aborted_during_execution',
          });
          return 'Analysis cancelled: superseded by newer request.';
        }
        throw error;
      }
    },
  });
}
