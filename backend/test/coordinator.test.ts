import { describe, expect, it } from 'vitest';

import { GenerationCoordinator, type StateTransitionEvent } from '../src/coordinator.js';
import { createSlowAnalysisTool, runCancellableSlowTool, ToolAbortError } from '../src/slow-tool.js';

describe('GenerationCoordinator & Cancellation Core', () => {
  it('A. normal generation completes and is accepted', async () => {
    const coordinator = new GenerationCoordinator(100);
    const transitions: StateTransitionEvent[] = [];
    coordinator.onStateChange((ev) => transitions.push(ev));

    const gen101 = coordinator.startGeneration({ query: 'fetch report' });
    expect(gen101.id).toBe(101);
    expect(coordinator.getActiveGenerationId()).toBe(101);
    expect(coordinator.isCurrentGeneration(101)).toBe(true);

    const result101 = await runCancellableSlowTool(
      { generationId: 101, query: 'fetch report', delayMs: 20 },
      coordinator.getSignal(101),
    );

    expect(result101.status).toBe('completed');
    expect(result101.generationId).toBe(101);

    const fenced = coordinator.fenceResult(101, result101);
    expect(fenced.accepted).toBe(true);
    if (fenced.accepted) {
      expect(fenced.data.generationId).toBe(101);
    }

    const stateNames = transitions.map((t) => t.state);
    expect(stateNames).toContain('GENERATION_STARTED');
    expect(stateNames).toContain('RESULT_ACCEPTED');
  });

  it('B. interruption aborts the active generation and controller', () => {
    const coordinator = new GenerationCoordinator(100);
    const transitions: StateTransitionEvent[] = [];
    coordinator.onStateChange((ev) => transitions.push(ev));

    const gen101 = coordinator.startGeneration();
    const signal = coordinator.getSignal(101);
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);

    coordinator.interrupt('user barge-in');

    expect(signal?.aborted).toBe(true);
    expect(coordinator.isCurrentGeneration(101)).toBe(false);
    expect(gen101.isValid).toBe(false);

    const stateNames = transitions.map((t) => t.state);
    expect(stateNames).toContain('INTERRUPTED');
    expect(stateNames).toContain('REQUEST_INVALIDATED');
  });

  it('C & D. stale result is discarded while current result is accepted', async () => {
    const coordinator = new GenerationCoordinator(100);
    const transitions: StateTransitionEvent[] = [];
    coordinator.onStateChange((ev) => transitions.push(ev));

    // Request 101 starts
    coordinator.startGeneration({ query: 'first parameter' });

    // User interrupts and changes parameters -> Request 102 starts
    coordinator.interrupt('parameter changed');
    coordinator.startGeneration({ query: 'updated parameter' });
    expect(coordinator.getActiveGenerationId()).toBe(102);

    // Simulated late-arriving result from generation 101
    const lateResult101 = {
      generationId: 101,
      query: 'first parameter',
      processedItems: 5,
      summary: 'outdated result',
      status: 'completed' as const,
    };

    const fenced101 = coordinator.fenceResult(101, lateResult101);
    expect(fenced101.accepted).toBe(false);
    if (!fenced101.accepted) {
      expect(fenced101.reason).toBe('stale_generation');
    }

    // Result for generation 102 arrives
    const result102 = await runCancellableSlowTool(
      { generationId: 102, query: 'updated parameter', delayMs: 20 },
      coordinator.getSignal(102),
    );

    const fenced102 = coordinator.fenceResult(102, result102);
    expect(fenced102.accepted).toBe(true);
    if (fenced102.accepted) {
      expect(fenced102.data.generationId).toBe(102);
    }

    const stateNames = transitions.map((t) => t.state);
    expect(stateNames).toContain('RESULT_DISCARDED');
    expect(stateNames).toContain('RESULT_ACCEPTED');
  });

  it('E. rapid sequence: 101 -> interrupt -> 102 -> interrupt -> 103 (only 103 accepted)', () => {
    const coordinator = new GenerationCoordinator(100);

    coordinator.startGeneration(); // 101
    coordinator.interrupt('rapid barge-in 1');

    coordinator.startGeneration(); // 102
    coordinator.interrupt('rapid barge-in 2');

    coordinator.startGeneration(); // 103
    expect(coordinator.getActiveGenerationId()).toBe(103);

    expect(coordinator.isCurrentGeneration(101)).toBe(false);
    expect(coordinator.isCurrentGeneration(102)).toBe(false);
    expect(coordinator.isCurrentGeneration(103)).toBe(true);

    // Results arrive out of order
    const late101 = coordinator.fenceResult(101, { data: 'stale 101' });
    const late102 = coordinator.fenceResult(102, { data: 'stale 102' });
    const valid103 = coordinator.fenceResult(103, { data: 'valid 103' });

    expect(late101.accepted).toBe(false);
    expect(late102.accepted).toBe(false);
    expect(valid103.accepted).toBe(true);
  });

  it('F. cancellation produces no unhandled rejection and stops work', async () => {
    const coordinator = new GenerationCoordinator(100);
    coordinator.startGeneration();
    const signal = coordinator.getSignal(101)!;

    let caughtError: unknown = null;
    const slowToolPromise = runCancellableSlowTool(
      { generationId: 101, query: 'lengthy computation', delayMs: 150 },
      signal,
    ).catch((err: unknown) => {
      caughtError = err;
    });

    // Interrupt mid-flight
    coordinator.interrupt('user cancelled');
    await slowToolPromise;

    expect(caughtError).toBeInstanceOf(ToolAbortError);
    expect(signal.aborted).toBe(true);

    // Even if something attempted to fence generation 101, it is rejected
    const fenced = coordinator.fenceResult(101, { status: 'should be discarded' });
    expect(fenced.accepted).toBe(false);
  });

  it('G. LiveKit tool wrapper honors AbortSignal.any and rejects stale results', async () => {
    const coordinator = new GenerationCoordinator(100);
    const slowTool = createSlowAnalysisTool(coordinator);

    // Normal execution under generation 101
    coordinator.startGeneration({ query: 'quarterly financial report' });
    const lkController = new AbortController();

    const output101 = await slowTool.execute(
      { query: 'quarterly financial report', delayMs: 20 },
      {
        abortSignal: lkController.signal,
        toolCallId: 'call-101',
        ctx: {} as any,
      },
    );

    expect(output101).toContain('quarterly financial report');

    // Interrupted execution: user barge-in during slowTool execution
    coordinator.startGeneration({ query: 'first topic' });
    const inFlightController = new AbortController();

    const inFlightPromise = slowTool.execute(
      { query: 'first topic', delayMs: 150 },
      {
        abortSignal: inFlightController.signal,
        toolCallId: 'call-102',
        ctx: {} as any,
      },
    );

    // User interrupts before tool finishes
    coordinator.interrupt('user barge-in');
    const interruptedOutput = await inFlightPromise;

    // Stale result was fenced/aborted and never produces valid spoken output
    expect(interruptedOutput).toContain('Analysis cancelled: superseded by newer request.');
  });
});
