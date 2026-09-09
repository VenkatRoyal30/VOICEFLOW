import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { cli, defineAgent, inference, ServerOptions, voice, type JobContext } from '@livekit/agents';
import { RemoteParticipant, RoomEvent, TrackKind, TrackSource } from '@livekit/rtc-node';

import { loadAgentEnvironment } from './config.js';
import { GenerationCoordinator } from './coordinator.js';
import { logger } from './logger.js';
import { createSlowAnalysisTool } from './slow-tool.js';
import { VOICEFLOW_SYSTEM_PROMPT } from './prompts.js';

const agent = defineAgent({
  entry: async (ctx: JobContext) => {
    loadAgentEnvironment();
    await ctx.connect();

    const coordinator = new GenerationCoordinator(100);
    const slowAnalysisTool = createSlowAnalysisTool(coordinator);

    const sttModel = (process.env.LIVEKIT_STT_MODEL as any) || 'deepgram/nova-3';
    const stt = new inference.STT({
      model: sttModel,
    });

    // Instrument STT stream to log when opened
    const originalSttStream = stt.stream.bind(stt);
    stt.stream = (options) => {
      logger.info({ model: sttModel }, '[TURN] LIVEKIT INFERENCE STT STREAM: Stream opened');
      const speechStream = originalSttStream(options);
      return speechStream;
    };

    const ttsModel = (process.env.LIVEKIT_TTS_MODEL as any) || 'rime/coda';
    const ttsVoice = process.env.LIVEKIT_TTS_VOICE || 'luna';
    const tts = new inference.TTS({
      model: ttsModel,
      voice: ttsVoice,
      language: 'en',
    });

    tts.on('error', (err) => {
      logger.error({ err }, '[TTS ERROR] LiveKit Inference TTS error event');
    });

    const originalTtsStream = tts.stream.bind(tts);
    tts.stream = (options) => {
      logger.info(
        { model: ttsModel, voice: ttsVoice },
        '[TTS START] LIVEKIT INFERENCE TTS STREAM: Synthesis stream opened',
      );
      const stream = originalTtsStream(options);

      let accumulatedTtsText = '';
      const origPushText = stream.pushText.bind(stream);
      stream.pushText = (text: string) => {
        accumulatedTtsText += text;
        logger.info(
          { chunk: text, accumulatedLength: accumulatedTtsText.length },
          `[TTS CHUNK] Pushed text chunk to TTS: "${text}"`,
        );
        return origPushText(text);
      };

      const origFlush = stream.flush.bind(stream);
      stream.flush = () => {
        logger.info(
          { totalLength: accumulatedTtsText.length },
          `[TTS FLUSH] Stream flushed (total accumulated text: "${accumulatedTtsText}")`,
        );
        return origFlush();
      };

      const origEndInput = stream.endInput.bind(stream);
      stream.endInput = () => {
        logger.info(
          { completeTtsText: accumulatedTtsText, length: accumulatedTtsText.length },
          `[TTS COMPLETION] Synthesis input ended. COMPLETE TTS TEXT: "${accumulatedTtsText}"`,
        );
        return origEndInput();
      };

      return stream;
    };

    const session = new voice.AgentSession({
      stt,
      llm: new inference.LLM({
        model: 'google/gemma-4-31b-it',
      }),
      tts,
      turnHandling: {
        turnDetection: new inference.TurnDetector(),
        endpointing: {
          minDelay: 300,
          maxDelay: 2000,
        },
        interruption: {
          mode: 'adaptive',
          enabled: true,
          minDuration: 1000,
          minWords: 0,
          falseInterruptionTimeout: 3000,
          resumeFalseInterruption: true,
          discardAudioIfUninterruptible: true,
        },
        preemptiveGeneration: {
          enabled: true,
          preemptiveTts: false,
        },
      },
      connOptions: {
        llmConnOptions: {
          timeoutMs: 30000,
        },
      },
    });

    // 1. User state changed: log microphone activity without false premature interruption
    session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
      logger.info(
        { oldState: ev.oldState, newState: ev.newState },
        ev.newState === 'speaking'
          ? '[USER TURN START] User speech activity detected'
          : '[USER TURN END] User speech activity stopped',
      );
    });

    // Interruption events: LiveKit native interruption and false interruption recovery
    session.on(voice.AgentSessionEventTypes.OverlappingSpeech, (ev) => {
      logger.info(
        { isInterruption: ev.isInterruption },
        `[INTERRUPTION] Overlapping speech detected (isInterruption: ${ev.isInterruption})`,
      );
      if (ev.isInterruption) {
        coordinator.interrupt('user_barge_in');
      }
    });

    session.on(voice.AgentSessionEventTypes.AgentFalseInterruption, (ev) => {
      logger.warn({ ev }, '[INTERRUPTION] False interruption detected by LiveKit; agent speech resuming');
    });

    // Capture and log complete LLM text generated before or during TTS synthesis
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      if (ev.item && 'role' in ev.item && ev.item.role === 'assistant') {
        const text =
          typeof ev.item.content === 'string'
            ? ev.item.content
            : Array.isArray(ev.item.content)
              ? ev.item.content.map((c) => (typeof c === 'string' ? c : (c as any).text || '')).join('')
              : JSON.stringify(ev.item.content);
        logger.info(
          { completeLlmText: text, length: text.length },
          `[LLM COMPLETE] Complete LLM text generated: "${text}"`,
        );
      }
    });

    // 2. User input transcribed: interim transcripts and finalized user turn
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (!ev.isFinal && ev.transcript && ev.transcript.trim().length > 0) {
        logger.info(
          { transcript: ev.transcript },
          `[STT INTERIM] Interim transcript: "${ev.transcript}"`,
        );
      }
      if (ev.isFinal && ev.transcript && ev.transcript.trim().length > 0) {
        logger.info(
          { transcript: ev.transcript },
          `[STT FINAL] Final transcript: "${ev.transcript}"`,
        );
        logger.info(
          { transcript: ev.transcript },
          `[USER TURN END] User turn finalized with transcript: "${ev.transcript}"`,
        );
        const newGen = coordinator.startGeneration({ transcript: ev.transcript });
        logger.info(
          { generationId: newGen.id, transcript: ev.transcript },
          `[TURN] GENERATION_STARTED: New generation #${newGen.id} started`,
        );
      }
    });

    // 3. Speech created: ensure initial/programmatic turns establish an active generation
    session.on(voice.AgentSessionEventTypes.SpeechCreated, (ev) => {
      logger.info({ source: ev.source }, `[AGENT REPLY START] Speech synthesis created for source: ${ev.source}`);
      if (ev.source === 'generate_reply' || ev.source === 'say') {
        const activeGen = coordinator.getActiveGeneration();
        if (!activeGen || !activeGen.isValid) {
          const newGen = coordinator.startGeneration({ source: ev.source });
          logger.info(
            { generationId: newGen.id, source: ev.source },
            `[TURN] GENERATION_STARTED: Generation #${newGen.id} started from ${ev.source}`,
          );
        }
      }
    });

    // 4. Agent state changed: reflect agent activity in VoiceFlow state transitions
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
      if (ev.newState === 'speaking') {
        logger.info(
          { generationId: coordinator.getActiveGenerationId() },
          `[AGENT REPLY START] Agent started speaking generation #${coordinator.getActiveGenerationId()}`,
        );
        coordinator.transitionState('SPEAKING');
      } else if (ev.oldState === 'speaking') {
        logger.info(
          { oldState: ev.oldState, newState: ev.newState, generationId: coordinator.getActiveGenerationId() },
          `[AGENT SPEECH END] Agent stopped speaking (now in ${ev.newState} state)`,
        );
      }
      if (ev.newState === 'thinking') {
        logger.info(
          { generationId: coordinator.getActiveGenerationId() },
          `[TURN] LLM/TOOL: LLM thinking for generation #${coordinator.getActiveGenerationId()}`,
        );
        coordinator.transitionState('THINKING');
      } else if (ev.newState === 'listening') {
        coordinator.transitionState('LISTENING');
      }
    });

    // 5. Diagnostic logging: surface inner error messages from providers (e.g. LLM/STT/TTS)
    session.on(voice.AgentSessionEventTypes.Error, (ev) => {
      const outer = ev.error as unknown as Record<string, unknown>;
      const inner = (outer && typeof outer === 'object' && 'error' in outer ? outer.error : outer) as
        | { message?: string; name?: string; statusCode?: number; stack?: string }
        | undefined;
      logger.error(
        {
          errorType: outer?.type,
          label: outer?.label,
          message: inner?.message ?? (outer as { message?: string })?.message,
          name: inner?.name,
          statusCode: inner?.statusCode,
          stack: inner?.stack,
        },
        '[AGENT ERROR] LiveKit AgentSession provider error (STT/LLM/TTS)',
      );
    });

    session.on(voice.AgentSessionEventTypes.Close, (ev) => {
      const outer = ev.error as unknown as Record<string, unknown> | null;
      const inner = (outer && typeof outer === 'object' && 'error' in outer ? outer.error : outer) as
        | { message?: string; name?: string; statusCode?: number }
        | undefined;
      logger.info(
        {
          reason: ev.reason,
          errorType: outer?.type,
          message: inner?.message ?? (outer as { message?: string })?.message,
        },
        'AgentSession closed',
      );
    });

    ctx.room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      logger.info(
        { participant: participant.identity, kind: participant.kind },
        'Remote participant connected to room',
      );
    });

    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      logger.info(
        { participant: participant.identity },
        'Remote participant disconnected from room',
      );
    });

    ctx.room.on(RoomEvent.TrackPublished, (publication, participant: RemoteParticipant) => {
      logger.info(
        {
          participant: participant.identity,
          kind: publication.kind,
          source: publication.source,
          sid: publication.sid,
        },
        'Remote microphone track published by participant',
      );
    });

    ctx.room.on(RoomEvent.TrackSubscribed, (track, publication, participant: RemoteParticipant) => {
      logger.info(
        {
          participant: participant.identity,
          kind: track.kind,
          source: publication.source,
          sid: publication.sid,
        },
        'Remote microphone audio track subscribed on backend',
      );
    });

    await session.start({
      room: ctx.room,
      agent: voice.Agent.create({
        instructions: VOICEFLOW_SYSTEM_PROMPT,
        tools: [slowAnalysisTool],
      }),
      inputOptions: {
        closeOnDisconnect: true,
      },
    });

    logger.info({ room: ctx.room.name }, 'VoiceFlow session started');
  },
});

export default agent;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: 'voiceflow',
    }),
  );
}
