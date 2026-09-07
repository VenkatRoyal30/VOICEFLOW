import { logger } from './logger.js';

export type CoordinatorState =
  | 'GENERATION_STARTED'
  | 'INTERRUPTED'
  | 'REQUEST_INVALIDATED'
  | 'RESULT_DISCARDED'
  | 'RESULT_ACCEPTED'
  | 'LISTENING'
  | 'THINKING'
  | 'TOOL_RUNNING'
  | 'SPEAKING';

export interface GenerationRecord {
  readonly id: number;
  readonly abortController: AbortController;
  readonly createdAt: number;
  isValid: boolean;
  metadata?: Record<string, unknown>;
}

export interface StateTransitionEvent {
  state: CoordinatorState;
  generationId: number | null;
  timestamp: number;
  details?: Record<string, unknown>;
}

export type FenceResult<T> =
  | { accepted: true; generationId: number; data: T }
  | { accepted: false; generationId: number; reason: 'stale_generation' | 'aborted' | 'invalidated' };

export type StateChangeListener = (event: StateTransitionEvent) => void;

export class GenerationCoordinator {
  private currentGenerationId: number;
  private activeGeneration: GenerationRecord | null = null;
  private readonly listeners: Set<StateChangeListener> = new Set();
  private currentState: CoordinatorState = 'LISTENING';

  constructor(initialGenerationId: number = 100) {
    this.currentGenerationId = initialGenerationId;
  }

  /**
   * Returns the currently active generation record, or null if none is active.
   */
  public getActiveGeneration(): GenerationRecord | null {
    return this.activeGeneration;
  }

  /**
   * Returns the current generation ID, or null if no generation is active.
   */
  public getActiveGenerationId(): number | null {
    return this.activeGeneration?.id ?? null;
  }

  /**
   * Returns the current observable state.
   */
  public getState(): CoordinatorState {
    return this.currentState;
  }

  /**
   * Subscribe to state transition events. Returns an unsubscribe function.
   */
  public onStateChange(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Emits a state transition, notifies listeners, and logs via Pino.
   */
  public transitionState(state: CoordinatorState, details?: Record<string, unknown>): void {
    this.currentState = state;
    const event: StateTransitionEvent = {
      state,
      generationId: this.activeGeneration?.id ?? null,
      timestamp: Date.now(),
      details,
    };

    logger.info(
      {
        state: event.state,
        generationId: event.generationId,
        timestamp: event.timestamp,
        ...details,
      },
      `VoiceFlow state: ${state}`,
    );

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error({ err }, 'Error in state transition listener');
      }
    }
  }

  /**
   * Starts a new generation. If a previous generation was active, it is
   * immediately invalidated and aborted.
   */
  public startGeneration(metadata?: Record<string, unknown>): GenerationRecord {
    if (this.activeGeneration && this.activeGeneration.isValid) {
      this.interrupt('superseded_by_new_generation');
    }

    this.currentGenerationId += 1;
    const generation: GenerationRecord = {
      id: this.currentGenerationId,
      abortController: new AbortController(),
      createdAt: Date.now(),
      isValid: true,
      metadata,
    };

    this.activeGeneration = generation;
    this.transitionState('GENERATION_STARTED', {
      generationId: generation.id,
      metadata,
    });

    return generation;
  }

  /**
   * Immediately invalidates and aborts the currently active generation.
   */
  public interrupt(reason: string = 'user_interruption'): void {
    if (!this.activeGeneration || !this.activeGeneration.isValid) {
      return;
    }

    const generation = this.activeGeneration;
    generation.isValid = false;

    this.transitionState('INTERRUPTED', {
      generationId: generation.id,
      reason,
    });

    try {
      generation.abortController.abort(reason);
    } catch (err) {
      logger.error({ err, generationId: generation.id }, 'Error aborting generation controller');
    }

    this.transitionState('REQUEST_INVALIDATED', {
      generationId: generation.id,
      reason,
    });
  }

  /**
   * Checks if a given generation ID is the currently active, valid, non-aborted generation.
   */
  public isCurrentGeneration(generationId: number): boolean {
    if (!this.activeGeneration) {
      return false;
    }
    return (
      this.activeGeneration.id === generationId &&
      this.activeGeneration.isValid &&
      !this.activeGeneration.abortController.signal.aborted
    );
  }

  /**
   * Returns the AbortSignal for the specified generation, or for the active generation if omitted.
   */
  public getSignal(generationId?: number): AbortSignal | undefined {
    if (generationId === undefined) {
      return this.activeGeneration?.abortController.signal;
    }
    if (this.activeGeneration?.id === generationId) {
      return this.activeGeneration.abortController.signal;
    }
    return undefined;
  }

  /**
   * Fences a result from a tool or operation against the active generation.
   * Stale, invalidated, or aborted results are rejected and NEVER allowed to reach speech.
   */
  public fenceResult<T>(generationId: number, result: T): FenceResult<T> {
    if (!this.activeGeneration || this.activeGeneration.id !== generationId) {
      this.transitionState('RESULT_DISCARDED', {
        generationId,
        activeGenerationId: this.activeGeneration?.id ?? null,
        reason: 'stale_generation',
      });
      return { accepted: false, generationId, reason: 'stale_generation' };
    }

    if (!this.activeGeneration.isValid) {
      this.transitionState('RESULT_DISCARDED', {
        generationId,
        reason: 'invalidated',
      });
      return { accepted: false, generationId, reason: 'invalidated' };
    }

    if (this.activeGeneration.abortController.signal.aborted) {
      this.transitionState('RESULT_DISCARDED', {
        generationId,
        reason: 'aborted',
      });
      return { accepted: false, generationId, reason: 'aborted' };
    }

    this.transitionState('RESULT_ACCEPTED', {
      generationId,
    });

    return { accepted: true, generationId, data: result };
  }
}
