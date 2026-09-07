import 'dotenv/config';

import { cli, defineAgent, inference, ServerOptions, voice, type JobContext } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as rime from '@livekit/agents-plugin-rime';
import { RemoteParticipant, RoomEvent, TrackKind, TrackSource } from '@livekit/rtc-node';
import { fileURLToPath } from 'node:url';

import { loadAgentEnvironment } from './config.js';
import { GenerationCoordinator } from './coordinator.js';
import { logger } from './logger.js';
import { createSlowAnalysisTool } from './slow-tool.js';
import { VOICEFLOW_SYSTEM_PROMPT } from './prompts.js';

const agent = defineAgent({
  entry: async (ctx: JobContext) => {
    loadAgentEnvironment();

    const coordinator = new GenerationCoordinator(100);
    const slowAnalysisTool = createSlowAnalysisTool(coordinator);

    const deepgramSTT = new deepgram.STT({
      model: 'nova-3',
      language: 'en-US',
    });

    // Instrument STT stream to log when opened and when audio frames arrive
    const originalSttStream = deepgramSTT.stream.bind(deepgramSTT);
    deepgramSTT.stream = (options) => {
      logger.info({ model: 'nova-3', language: 'en-US' }, '[TURN] DEEPGRAM STREAM: Stream opened');
      const speechStream = originalSttStream(options);
      let frameCount = 0;
      const originalPushFrame = speechStream.pushFrame.bind(speechStream);
      speechStream.pushFrame = (frame) => {
        frameCount++;
        if (frameCount === 1 || frameCount % 100 === 0) {
          logger.info(
            {
              framesReceived: frameCount,
              sampleRate: frame.sampleRate,
              channels: frame.channels,
              samplesPerChannel: frame.samplesPerChannel,
            },
            `[TURN] MIC AUDIO \u2192 DEEPGRAM STREAM: ${frameCount} audio frames received`,
          );
        }
        return originalPushFrame(frame);
      };
      return speechStream;
    };

    const session = new voice.AgentSession({
      stt: deepgramSTT,
      llm: new inference.LLM({
        model: 'google/gemma-4-31b-it',
      }),
      tts: new rime.TTS({
        modelId: 'coda',
        speaker: 'celeste',
        useWebsocket: true,
        segment: 'immediate',
      }),
      vad: null,
      turnDetection: 'stt',
      turnHandling: {
        endpointing: {
          minDelay: 100,
          maxDelay: 1500,
        },
        preemptiveGeneration: {
  enabled: false,
  preemptiveTts: false,
},
      },
      connOptions: {
        llmConnOptions: {
          timeoutMs: 30000,
        },
      },
    });

    // 1. User state changed: detect barge-in ONLY when user starts speaking while the agent is speaking
    session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
      logger.info(
        { oldState: ev.oldState, newState: ev.newState },
        ev.newState === 'speaking'
          ? '[TURN] SPEECH START: User speech detected'
          : '[TURN] SPEECH END: User speech stopped',
      );

      if (ev.newState === 'speaking') {
        const isAgentSpeaking = session.agentState === 'speaking' || coordinator.getState() === 'SPEAKING';
        if (!isAgentSpeaking) {
          logger.debug(
            { agentState: session.agentState, coordinatorState: coordinator.getState() },
            'User speaking while agent is not speaking; ignoring as barge-in',
          );
          return;
        }

        const interruptedId = coordinator.getActiveGenerationId();
        logger.info(
          {
            oldState: ev.oldState,
            agentState: session.agentState,
            activeGenerationId: interruptedId,
          },
          '[INTERRUPTION] GENERATION_INVALIDATED \u2192 cancellation signal fired \u2192 old task terminated \u2192 awaiting new generation',
        );
        coordinator.interrupt('user_barge_in');
        try {
          const fut = session.interrupt();
          void fut.await
            .then(() => {
              logger.info(
                { interruptedGenerationId: interruptedId },
                '[INTERRUPTION] Old speech task terminated cleanly',
              );
            })
            .catch((err: unknown) => {
              logger.debug({ err }, 'Speech interruption completed or no speech playing');
            });
        } catch (err: unknown) {
          logger.debug({ err }, 'Session interrupt call threw synchronously');
        }
      }
    });

    // 2. User input transcribed: finalized user turn starts a fresh generation
    session.on(
  voice.AgentSessionEventTypes.UserInputTranscribed,
  async (ev) => {
    logger.info(
      { transcript: ev.transcript, isFinal: ev.isFinal },
      'Deepgram STT transcript received',
    );

    if (ev.isFinal && ev.transcript.trim().length > 0) {
      logger.info(
        { transcript: ev.transcript },
        `[TURN] FINAL TRANSCRIPT: User transcript finalized: "${ev.transcript}"`,
      );

      const newGen = coordinator.startGeneration({
        transcript: ev.transcript,
      });

      logger.info(
        { generationId: newGen.id, transcript: ev.transcript },
        `[TURN] GENERATION_STARTED: New generation #${newGen.id} started`,
      );

      try {
        await session.generateReply({
          instructions: ev.transcript,
        });

        logger.info(
          { generationId: newGen.id },
          `[TURN] LLM_REPLY_REQUESTED: Generation #${newGen.id} sent to LiveKit LLM`,
        );
      } catch (error) {
        logger.error(
          { error, generationId: newGen.id },
          `[TURN] LLM_REPLY_FAILED: Generation #${newGen.id} failed`,
        );
      }
    }
  },
);

    // 3. Speech created: ensure initial/programmatic turns establish an active generation
    session.on(voice.AgentSessionEventTypes.SpeechCreated, (ev) => {
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
          `[TURN] TTS \u2192 SPEAKING: Rime TTS playback active for generation #${coordinator.getActiveGenerationId()}`,
        );
        coordinator.transitionState('SPEAKING');
      } else if (ev.newState === 'thinking') {
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
        | { message?: string; name?: string; statusCode?: number }
        | undefined;
      logger.error(
        {
          errorType: outer?.type,
          label: outer?.label,
          message: inner?.message ?? (outer as { message?: string })?.message,
          name: inner?.name,
          statusCode: inner?.statusCode,
        },
        'AgentSession provider error',
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
              (pub.kind === TrackKind.KIND_AUDIO || (pub.track && pub.track.kind === TrackKind.KIND_AUDIO)) &&
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
      if (publication.source === TrackSource.SOURCE_MICROPHONE) {
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
      if (publication.source === TrackSource.SOURCE_MICROPHONE) {
        syncActiveAudioParticipant(participant);
      }
    });

    await ctx.connect();

    await session.start({
      room: ctx.room,
      agent: voice.Agent.create({
        instructions: VOICEFLOW_SYSTEM_PROMPT,
        tools: [slowAnalysisTool],
      }),
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
