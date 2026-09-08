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

    // Instrument STT stream to log when opened and when audio frames arrive
    const originalSttStream = stt.stream.bind(stt);
    stt.stream = (options) => {
      logger.info({ model: sttModel }, '[TURN] LIVEKIT INFERENCE STT STREAM: Stream opened');
      const speechStream = originalSttStream(options);
      let frameCount = 0;
      const originalPushFrame = speechStream.pushFrame.bind(speechStream);
      speechStream.pushFrame = (frame) => {
        frameCount++;
        if (frameCount === 1 || frameCount % 25 === 0) {
          logger.info(
            {
              framesReceived: frameCount,
              sampleRate: frame.sampleRate,
              channels: frame.channels,
              samplesPerChannel: frame.samplesPerChannel,
            },
            `[MIC AUDIO] Audio frame #${frameCount} received by STT stream (${frame.samplesPerChannel} samples @ ${frame.sampleRate}Hz)`,
          );
        }
        return originalPushFrame(frame);
      };
      return speechStream;
    };

    const ttsModel = (process.env.LIVEKIT_TTS_MODEL as any) || 'cartesia/sonic-3.5';
    const tts = new inference.TTS({
      model: ttsModel,
      fallback: ['deepgram/aura-2'],
    });

    tts.on('error', (err) => {
      logger.error({ err }, '[TTS ERROR] LiveKit Inference TTS error event');
    });

    const originalTtsStream = tts.stream.bind(tts);
    tts.stream = (options) => {
      logger.info({ model: ttsModel }, '[TTS START] LIVEKIT INFERENCE TTS STREAM: Synthesis stream opened');
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
        endpointing: {
          minDelay: 300,
          maxDelay: 2000,
        },
        interruption: {
          enabled: true,
          minDuration: 1000, // require at least 1s of sustained speech to avoid speaker echo
          minWords: 0,
          falseInterruptionTimeout: 3000,
          resumeFalseInterruption: true,
        },
        preemptiveGeneration: {
          enabled: true,
          preemptiveTts: true,
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

    // Function to ensure RoomIO links to the active participant publishing microphone audio
    const syncActiveAudioParticipant = (targetParticipant?: RemoteParticipant) => {
      const roomIO = (
        session as unknown as {
          _roomIO?: {
            setParticipant: (id: string) => void;
            participantIdentity?: string | null;
          };
        }
      )._roomIO;

      if (!roomIO) return;

      let participantToLink = targetParticipant;
      if (!participantToLink) {
        for (const p of ctx.room.remoteParticipants.values()) {
          for (const pub of p.trackPublications.values()) {
            if (
              pub.kind === TrackKind.KIND_AUDIO ||
              (pub.track && pub.track.kind === TrackKind.KIND_AUDIO) ||
              pub.source === TrackSource.SOURCE_MICROPHONE
            ) {
              participantToLink = p;
              break;
            }
          }
          if (participantToLink) break;
        }
      }

      if (participantToLink && roomIO.participantIdentity !== participantToLink.identity) {
        logger.info(
          {
            previousLinkedParticipant: roomIO.participantIdentity,
            newLinkedParticipant: participantToLink.identity,
          },
          'Binding agent audio input to active microphone participant',
        );
        roomIO.setParticipant(participantToLink.identity);
      }
    };

    ctx.room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      logger.info(
        { participant: participant.identity, kind: participant.kind },
        'Remote participant connected to room',
      );
      syncActiveAudioParticipant(participant);
    });

    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      logger.info(
        { participant: participant.identity },
        'Remote participant disconnected from room',
      );
      syncActiveAudioParticipant();
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
      if (publication.kind === TrackKind.KIND_AUDIO || publication.source === TrackSource.SOURCE_MICROPHONE) {
        syncActiveAudioParticipant(participant);
      }
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
      if (track.kind === TrackKind.KIND_AUDIO || publication.source === TrackSource.SOURCE_MICROPHONE) {
        syncActiveAudioParticipant(participant);
      }
    });

    await session.start({
      room: ctx.room,
      agent: voice.Agent.create({
        instructions: VOICEFLOW_SYSTEM_PROMPT,
        tools: [slowAnalysisTool],
      }),
      inputOptions: {
        closeOnDisconnect: false,
      },
    });

    // Ensure audio input is linked to any active participant already in room
    syncActiveAudioParticipant();

    logger.info({ room: ctx.room.name }, 'VoiceFlow session started');

    await session.generateReply({
      instructions: 'Greet the user briefly and ask how you can help.',
    });
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
