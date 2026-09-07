import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  LocalTrack,
  Participant,
  ParticipantKind,
  TranscriptionSegment,
} from 'livekit-client';
import {
  AgentState,
  ConnectionStatus,
  CoordinatorEvent,
  GenerationInfo,
  ChatMessage,
} from './types';

interface UseLiveKitVoiceReturn {
  connectionStatus: ConnectionStatus;
  roomName: string;
  agentState: AgentState;
  activeGenerationId: number;
  isMicActive: boolean;
  isUserSpeaking: boolean;
  isAgentSpeaking: boolean;
  interruptionNotice: string | null;
  errorMessage: string | null;
  micPermissionError: string | null;
  audioVolume: number; // 0.0 - 1.0 for real microphone audio visualizer
  activeGen: GenerationInfo;
  previousGen: GenerationInfo | null;
  messages: ChatMessage[];
  events: CoordinatorEvent[];
  currentUserTranscript: string;
  isLiveMode: boolean;
  connect: (roomName?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  toggleMicrophone: () => Promise<void>;
  clearEvents: () => void;
  // Offline Demo Simulation triggers (for presentation rehearsal)
  triggerDemoNormalTurn: () => void;
  triggerDemoSlowAnalysis: () => void;
  triggerDemoBargeIn: () => void;
  resetDemoSession: () => void;
}

export function useLiveKitVoice(): UseLiveKitVoiceReturn {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [roomName, setRoomName] = useState<string>('voiceflow-demo');
  const [agentState, setAgentState] = useState<AgentState>('LISTENING');
  const [activeGenerationId, setActiveGenerationId] = useState<number>(101);
  const [isMicActive, setIsMicActive] = useState<boolean>(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState<boolean>(false);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState<boolean>(false);
  const [interruptionNotice, setInterruptionNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [micPermissionError, setMicPermissionError] = useState<string | null>(null);
  const [audioVolume, setAudioVolume] = useState<number>(0);
  const [currentUserTranscript, setCurrentUserTranscript] = useState<string>('');
  const [isLiveMode, setIsLiveMode] = useState<boolean>(false);

  const [activeGen, setActiveGen] = useState<GenerationInfo>({
    id: 101,
    status: 'active',
    query: 'Ready for real voice input',
    startedAt: Date.now(),
    source: 'livekit',
  });
  const [previousGen, setPreviousGen] = useState<GenerationInfo | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<CoordinatorEvent[]>([]);

  const roomRef = useRef<Room | null>(null);
  const agentAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const activeGenIdRef = useRef<number>(101);
  const agentStateRef = useRef<AgentState>('LISTENING');
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectingRef = useRef<boolean>(false);

  // Turn tracking, segmentation and stale-result fencing refs
  const interruptedGensRef = useRef<Set<number>>(new Set());
  const agentSegmentsRef = useRef<Map<number, Map<string, string>>>(new Map());
  const acceptedGensRef = useRef<Set<number>>(new Set());
  const hasTurnStartedRef = useRef<boolean>(false);

  activeGenIdRef.current = activeGenerationId;
  agentStateRef.current = agentState;

  const addEvent = useCallback(
    (
      state: CoordinatorEvent['state'],
      genId: number,
      details?: string,
      reason?: string,
      source: CoordinatorEvent['source'] = 'livekit',
    ) => {
      const newEvent: CoordinatorEvent = {
        id: `ev-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: Date.now(),
        state,
        generationId: genId,
        details,
        reason,
        source,
      };
      setEvents((prev) => [newEvent, ...prev.slice(0, 59)]);
    },
    [],
  );

  // Checks whether a participant is strictly the VoiceFlow AI agent (and NOT a human user or local participant)
  const isAgentParticipant = useCallback((p?: Participant | RemoteParticipant | null): boolean => {
    if (!p) return false;
    const room = roomRef.current;

    // 1. Explicitly reject if it is the local participant instance
    if (room && p === room.localParticipant) return false;

    // 2. Explicitly reject if identity matches local participant identity
    if (
      room &&
      room.localParticipant &&
      room.localParticipant.identity &&
      p.identity === room.localParticipant.identity
    ) {
      return false;
    }

    // 3. Any participant whose identity starts with 'user-' is a human user, NEVER the agent
    if (p.identity.startsWith('user-') || p.identity.startsWith('user_')) {
      return false;
    }

    // 4. Positive Agent matching:
    // Identity or name matches the VoiceFlow agent worker ('voiceflow' or 'agent-...')
    const id = p.identity.toLowerCase();
    if (id === 'voiceflow' || id.startsWith('agent-') || id.startsWith('agent_')) {
      return true;
    }
    const name = (p.name || '').toLowerCase();
    if (name === 'voiceflow' || name.startsWith('agent-') || name.startsWith('agent_')) {
      return true;
    }

    // Explicit LiveKit agent markers
    if (p.isAgent === true) return true;
    if (p.kind === ParticipantKind.AGENT) return true;
    if (p.permissions && p.permissions.agent === true) return true;

    // 5. Participants with explicit non-agent permission must be rejected
    if (p.permissions && p.permissions.agent === false) {
      return false;
    }

    // 6. LiveKit ParticipantKind.STANDARD is a human user if not matched above
    if (p.kind === ParticipantKind.STANDARD) {
      return false;
    }

    return false;
  }, []);

  // Attaches ONLY remote agent audio track to a dedicated, managed audio element
  const attachAgentAudioTrack = useCallback(
    (track: RemoteTrack, participant?: RemoteParticipant) => {
      // 1. Guard against non-agent participant audio
      if (participant && !isAgentParticipant(participant)) {
        console.warn('Rejected audio track from non-agent participant:', participant.identity);
        return;
      }

      // 2. Reject if track is a LocalTrack or not a RemoteTrack
      if (track instanceof LocalTrack || !(track instanceof RemoteTrack)) {
        console.warn('Rejected non-remote track from playback:', (track as Track)?.sid);
        return;
      }

      // 3. Reject if track matches any local participant publication or mediaStreamTrack
      const room = roomRef.current;
      if (room && room.localParticipant) {
        for (const pub of room.localParticipant.getTrackPublications()) {
          if (pub.trackSid && track.sid === pub.trackSid) {
            console.warn('Rejected track matching local publication trackSid:', track.sid);
            return;
          }
          if (
            pub.track?.mediaStreamTrack &&
            track.mediaStreamTrack &&
            pub.track.mediaStreamTrack.id === track.mediaStreamTrack.id
          ) {
            console.warn('Rejected track matching local mediaStreamTrack ID:', track.mediaStreamTrack.id);
            return;
          }
        }
      }

      // 4. Ensure a single managed <audio> element exists
      let audioEl = agentAudioElementRef.current;
      if (!audioEl) {
        const existing = document.getElementById('voiceflow-agent-audio');
        if (existing && existing instanceof HTMLAudioElement) {
          audioEl = existing;
        } else {
          audioEl = document.createElement('audio');
          audioEl.id = 'voiceflow-agent-audio';
          audioEl.autoplay = true;
          document.body.appendChild(audioEl);
        }
        agentAudioElementRef.current = audioEl;
      }

      audioEl.muted = false;
      track.attach(audioEl);
      audioEl.play().catch((err) => {
        console.warn('Agent audio autoplay was prevented by browser policy:', err);
      });
    },
    [isAgentParticipant],
  );

  const detachAgentAudioTrack = useCallback((track: RemoteTrack) => {
    if (agentAudioElementRef.current) {
      track.detach(agentAudioElementRef.current);
    }
  }, []);

  const cleanupAgentAudio = useCallback(() => {
    if (agentAudioElementRef.current) {
      agentAudioElementRef.current.pause();
      agentAudioElementRef.current.srcObject = null;
      agentAudioElementRef.current.remove();
      agentAudioElementRef.current = null;
    }
    const existing = document.getElementById('voiceflow-agent-audio');
    if (existing && existing instanceof HTMLAudioElement) {
      existing.pause();
      existing.srcObject = null;
      existing.remove();
    }
  }, []);

  // Monitor microphone volume natively using LiveKit's participant.audioLevel (NO Web Audio routing)
  const startVolumeMonitor = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    const updateVolume = () => {
      const room = roomRef.current;
      if (room && room.localParticipant && room.localParticipant.isMicrophoneEnabled) {
        // Native LiveKit audioLevel (normalized 0.0 - 1.0)
        const level = room.localParticipant.audioLevel;
        setAudioVolume(level);
      } else {
        setAudioVolume(0);
      }
      animFrameRef.current = requestAnimationFrame(updateVolume);
    };
    animFrameRef.current = requestAnimationFrame(updateVolume);
  }, []);

  const stopVolumeMonitor = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setAudioVolume(0);
  }, []);

  // Fetch token from backend token server or Vercel serverless function
  const fetchLiveKitToken = async (
    targetRoom: string,
    identity: string,
  ): Promise<{ serverUrl: string; participantToken: string }> => {
    const tokenUrl = `/api/token?room=${encodeURIComponent(targetRoom)}&identity=${encodeURIComponent(identity)}`;

    // 1. Primary path: /api/token (Vercel serverless function in production, Vite dev proxy in local development)
    try {
      const res = await fetch(tokenUrl);
      if (res.ok) {
        return await res.json();
      }

      const errJson = await res.json().catch(() => ({}));
      const errorDetail = errJson.error || `Token endpoint returned status ${res.status}`;

      // In production, immediately throw error without localhost fallback
      if (!import.meta.env.DEV) {
        throw new Error(`Failed to obtain LiveKit token: ${errorDetail}`);
      }
    } catch (err) {
      // In production, do not attempt localhost fallback
      if (!import.meta.env.DEV) {
        throw err instanceof Error ? err : new Error(`Failed to obtain LiveKit token: ${String(err)}`);
      }
    }

    // 2. Local development fallback only: try direct port 3001 if dev proxy is inactive
    if (import.meta.env.DEV) {
      const directUrl = `http://localhost:3001/token?room=${encodeURIComponent(targetRoom)}&identity=${encodeURIComponent(identity)}`;
      try {
        const directRes = await fetch(directUrl);
        if (directRes.ok) {
          return await directRes.json();
        }
        const errJson = await directRes.json().catch(() => ({}));
        throw new Error(errJson.error || `Token server returned status ${directRes.status}`);
      } catch (err) {
        throw new Error(
          `Unable to reach VoiceFlow token server at /api/token or http://localhost:3001.\nEnsure the token server is running by executing: pnpm token:dev\nDetails: ${(err as Error).message}`,
        );
      }
    }

    throw new Error('Failed to obtain LiveKit token from /api/token');
  };

  // Connect to LiveKit room
  const connect = useCallback(
    async (targetRoom: string = 'voiceflow-demo') => {
      if (isConnectingRef.current) return;
      if (
        roomRef.current &&
        (roomRef.current.state === ConnectionState.Connected ||
          roomRef.current.state === ConnectionState.Connecting)
      ) {
        return;
      }
      isConnectingRef.current = true;

      setErrorMessage(null);
      setMicPermissionError(null);
      setInterruptionNotice(null);
      setConnectionStatus('connecting');
      setRoomName(targetRoom);

      try {
        let identity = '';
        try {
          identity = sessionStorage.getItem('voiceflow_user_identity') || '';
        } catch {
          // ignore storage error
        }
        if (!identity) {
          identity = `user-${Math.random().toString(36).substring(2, 7)}`;
          try {
            sessionStorage.setItem('voiceflow_user_identity', identity);
          } catch {
            // ignore storage error
          }
        }
        const { serverUrl, participantToken } = await fetchLiveKitToken(targetRoom, identity);

        // Disconnect existing room if any
        if (roomRef.current) {
          await roomRef.current.disconnect();
          cleanupAgentAudio();
        }

        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
          audioCaptureDefaults: {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        roomRef.current = room;

        // Register room event handlers
        room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
          if (state === ConnectionState.Connected) {
            setConnectionStatus('connected');
            setIsLiveMode(true);
            setActiveGen((prev) => ({
              ...prev,
              source: 'livekit',
            }));
          } else if (state === ConnectionState.Connecting || state === ConnectionState.Reconnecting) {
            setConnectionStatus('connecting');
          } else if (state === ConnectionState.Disconnected) {
            setConnectionStatus('disconnected');
            setIsMicActive(false);
            stopVolumeMonitor();
            cleanupAgentAudio();
          }
        });

        room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
          if (isAgentParticipant(participant)) {
            addEvent(
              'CONNECTED',
              activeGenIdRef.current,
              `VoiceFlow Agent connected to room (${participant.identity})`,
              undefined,
              'backend',
            );
            for (const pub of participant.trackPublications.values()) {
              if (pub.kind === Track.Kind.Audio) {
                pub.setSubscribed(true);
              }
            }
          } else {
            for (const pub of participant.trackPublications.values()) {
              pub.setSubscribed(false);
            }
          }
        });

        room.on(RoomEvent.Disconnected, () => {
          setConnectionStatus('disconnected');
          setIsMicActive(false);
          setIsUserSpeaking(false);
          setIsAgentSpeaking(false);
          stopVolumeMonitor();
          cleanupAgentAudio();
          addEvent('DISCONNECTED', activeGenIdRef.current, 'Disconnected from LiveKit room');
        });

        // Track Published handler: ONLY subscribe to tracks from VoiceFlow Agent
        room.on(
          RoomEvent.TrackPublished,
          (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            if (publication.kind === Track.Kind.Audio) {
              if (isAgentParticipant(participant)) {
                publication.setSubscribed(true);
              } else {
                publication.setSubscribed(false);
              }
            }
          },
        );

        // 1. Audio Track Subscription: Rime TTS voice playout from Agent ONLY
        room.on(
          RoomEvent.TrackSubscribed,
          (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            if (track.kind !== Track.Kind.Audio) return;

            // STRICT FILTER: NEVER attach user audio, local audio, or non-agent audio
            if (!isAgentParticipant(participant)) {
              console.warn('Blocking and unsubscribing audio track from non-agent participant:', participant.identity);
              publication.setSubscribed(false);
              return;
            }

            attachAgentAudioTrack(track, participant);
            addEvent(
              'SPEAKING',
              activeGenIdRef.current,
              `Subscribed to VoiceFlow agent audio (LiveKit Inference TTS from ${participant.identity})`,
              undefined,
              'backend',
            );
          },
        );

        room.on(
          RoomEvent.TrackUnsubscribed,
          (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            if (track.kind === Track.Kind.Audio && isAgentParticipant(participant)) {
              detachAgentAudioTrack(track);
            }
          },
        );

        // 2. Active Speakers: User speech & Agent speech tracking
        room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
          const isUserNowSpeaking = room.localParticipant.isSpeaking;
          const isAgentNowSpeaking = speakers.some(
            (s) => isAgentParticipant(s) && s.isSpeaking,
          );

          setIsUserSpeaking(isUserNowSpeaking);
          setIsAgentSpeaking(isAgentNowSpeaking);

          if (isAgentNowSpeaking) {
            setAgentState('SPEAKING');
          } else if (isUserNowSpeaking) {
            // Check for real-time barge-in
            if (agentStateRef.current === 'SPEAKING') {
              const interruptedId = activeGenIdRef.current;
              const nextGenId = interruptedId + 1;
              interruptedGensRef.current.add(interruptedId);
              hasTurnStartedRef.current = false;
              setCurrentUserTranscript('');
              setActiveGenerationId(nextGenId);
              activeGenIdRef.current = nextGenId;
              setAgentState('INTERRUPTED');
              setInterruptionNotice(
                `Barge-In Detected: User speaking over agent. Invalidating Gen #${interruptedId}`,
              );

              setPreviousGen({
                id: interruptedId,
                status: 'interrupted',
                query: 'Interrupted by user barge-in',
                startedAt: Date.now() - 2000,
                endedAt: Date.now(),
                discardReason: 'RESULT_DISCARDED (user barge-in)',
                source: 'livekit',
              });

              setActiveGen({
                id: nextGenId,
                status: 'active',
                query: 'Listening to interrupting speech...',
                startedAt: Date.now(),
                source: 'livekit',
              });

              addEvent(
                'INTERRUPTED',
                interruptedId,
                'User barge-in detected over agent speech',
                'user_barge_in',
                'livekit',
              );
              addEvent(
                'REQUEST_INVALIDATED',
                interruptedId,
                'Active generation superseded by user speech',
                'user_barge_in',
                'livekit',
              );
              addEvent(
                'GENERATION_STARTED',
                nextGenId,
                'New generation started from barge-in turn',
                undefined,
                'livekit',
              );

              setMessages((prev) =>
                prev.map((m) =>
                  m.generationId === interruptedId && m.role === 'agent'
                    ? { ...m, interrupted: true }
                    : m,
                ),
              );
            } else {
              setAgentState('LISTENING');
            }
          } else if (room.state === ConnectionState.Connected) {
            // Neither speaking
            if (agentStateRef.current === 'SPEAKING' || agentStateRef.current === 'INTERRUPTED') {
              setAgentState('LISTENING');
            }
          }
        });

        // 3. Transcription Events: Deepgram STT (user) & Rime TTS (agent)
        room.on(
          RoomEvent.TranscriptionReceived,
          (segments: TranscriptionSegment[], participant?: Participant) => {
            for (const seg of segments) {
              const isLocal = !participant || participant.identity === room.localParticipant.identity;

              if (isLocal) {
                // User transcription from Deepgram STT
                if (seg.final && seg.text.trim()) {
                  setCurrentUserTranscript('');

                  // Monotonic generation ID advancement for new conversational turns
                  if (hasTurnStartedRef.current) {
                    const nextId = activeGenIdRef.current + 1;
                    setActiveGenerationId(nextId);
                    activeGenIdRef.current = nextId;
                  } else {
                    hasTurnStartedRef.current = true;
                  }

                  const currentId = activeGenIdRef.current;
                  setInterruptionNotice(null);

                  // 5. User messages appear immediately when final Deepgram transcript is received
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `msg-u-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
                      role: 'user',
                      content: seg.text.trim(),
                      generationId: currentId,
                      timestamp: Date.now(),
                    },
                  ]);
                  setActiveGen((prev) => ({
                    ...prev,
                    id: currentId,
                    query: seg.text.trim(),
                    status: 'active',
                    startedAt: Date.now(),
                    toolRunning: false,
                    resultSummary: undefined,
                  }));
                  addEvent(
                    'GENERATION_STARTED',
                    currentId,
                    `Inference STT finalized: "${seg.text.trim()}"`,
                    undefined,
                    'livekit',
                  );
                  setAgentState('THINKING');
                } else if (!seg.final) {
                  setCurrentUserTranscript(seg.text);
                }
              } else {
                // Agent transcription from Rime TTS / LLM
                const currentId = activeGenIdRef.current;

                // 7 & 8. Stale-result fencing & interruption protection:
                // If this generation was interrupted or superseded, discard stale transcription
                if (interruptedGensRef.current.has(currentId)) {
                  addEvent(
                    'RESULT_DISCARDED',
                    currentId,
                    `Stale agent transcription segment "${seg.text.slice(0, 30)}..." discarded after barge-in`,
                    'stale_generation',
                    'livekit',
                  );
                  continue;
                }

                if (seg.text && seg.text.trim()) {
                  let genSegments = agentSegmentsRef.current.get(currentId);
                  if (!genSegments) {
                    genSegments = new Map<string, string>();
                    agentSegmentsRef.current.set(currentId, genSegments);
                  }
                  // Store or update this segment's text keyed by seg.id
                  genSegments.set(seg.id, seg.text.trim());

                  // 1, 2, 3, 4. Display complete/current response as TEXT before or as Rime TTS begins speaking
                  const completeResponse = Array.from(genSegments.values()).join(' ');

                  if (completeResponse.length > 0) {
                    setMessages((prev) => {
                      const existingIndex = prev.findIndex(
                        (m) => m.generationId === currentId && m.role === 'agent',
                      );
                      if (existingIndex >= 0) {
                        const updated = [...prev];
                        updated[existingIndex] = {
                          ...updated[existingIndex],
                          content: completeResponse,
                        };
                        return updated;
                      } else {
                        return [
                          ...prev,
                          {
                            id: `msg-a-${currentId}-${Date.now()}`,
                            role: 'agent',
                            content: completeResponse,
                            generationId: currentId,
                            timestamp: Date.now(),
                          },
                        ];
                      }
                    });

                    setActiveGen((prev) =>
                      prev.id === currentId
                        ? { ...prev, resultSummary: completeResponse }
                        : prev,
                    );

                    // Signal accepted generation on first arrival of LLM response
                    if (!acceptedGensRef.current.has(currentId)) {
                      acceptedGensRef.current.add(currentId);
                      addEvent(
                        'RESULT_ACCEPTED',
                        currentId,
                        `VoiceFlow response ready for Gen #${currentId}`,
                        undefined,
                        'backend',
                      );
                      if (agentStateRef.current === 'THINKING') {
                        setAgentState('SPEAKING');
                      }
                    }
                  }
                }
              }
            }
          },
        );

        // 4. Data Messages: Coordinator Telemetry from backend if sent
        room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
          try {
            const text = new TextDecoder().decode(payload);
            const data = JSON.parse(text);
            if (data && data.state) {
              const genId = data.generationId || activeGenIdRef.current;
              addEvent(
                data.state,
                genId,
                data.msg || data.details,
                data.reason,
                'backend',
              );
              if (data.state === 'SPEAKING') setAgentState('SPEAKING');
              else if (data.state === 'THINKING') setAgentState('THINKING');
              else if (data.state === 'TOOL_RUNNING') setAgentState('PROCESSING_TOOL');
              else if (data.state === 'INTERRUPTED') setAgentState('INTERRUPTED');
              else if (data.state === 'LISTENING') setAgentState('LISTENING');

              if (data.generationId) {
                setActiveGenerationId(data.generationId);
                setActiveGen((prev) => ({
                  ...prev,
                  id: data.generationId,
                  source: 'backend',
                }));
              }
            }
          } catch {
            // Ignore non-json data
          }
        });

        // 5. Connect WebRTC room with autoSubscribe disabled (prevents receiving any other human tracks)
        await room.connect(serverUrl, participantToken, { autoSubscribe: false });
        addEvent('CONNECTED', 101, `Connected to LiveKit room "${targetRoom}"`, undefined, 'livekit');

        // Check already connected remote participants (in case agent was already in the room)
        for (const p of room.remoteParticipants.values()) {
          if (isAgentParticipant(p)) {
            for (const pub of p.trackPublications.values()) {
              if (pub.kind === Track.Kind.Audio) {
                pub.setSubscribed(true);
                if (pub.track) {
                  attachAgentAudioTrack(pub.track as RemoteTrack, p);
                }
              }
            }
          } else {
            for (const pub of p.trackPublications.values()) {
              pub.setSubscribed(false);
            }
          }
        }

        // 6. Request microphone permission & publish audio track to LiveKit
        try {
          await room.localParticipant.setMicrophoneEnabled(true, {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true,
          });
          setIsMicActive(true);
          setMicPermissionError(null);

          // Start native LiveKit participant.audioLevel volume monitor
          startVolumeMonitor();

          addEvent(
            'LISTENING',
            101,
            'Microphone track published to LiveKit. Inference STT ready.',
            undefined,
            'livekit',
          );
        } catch (micErr: unknown) {
          const err = micErr as { name?: string; message?: string };
          console.error('Microphone acquisition error:', micErr);
          let userNotice = 'Unable to access your microphone.';
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            userNotice =
              'Microphone permission was denied by your browser. Please click the lock/camera icon in your address bar and grant microphone access, then click the microphone button to retry.';
          } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            userNotice = 'No microphone device was detected on your computer.';
          } else if (err.message) {
            userNotice = `Microphone error: ${err.message}`;
          }
          setMicPermissionError(userNotice);
          setIsMicActive(false);
        }

        // 7. Subscribe to and attach existing remote tracks ONLY IF they belong to the agent
        for (const remoteParticipant of room.remoteParticipants.values()) {
          if (isAgentParticipant(remoteParticipant)) {
            for (const pub of remoteParticipant.audioTrackPublications.values()) {
              pub.setSubscribed(true);
              if (pub.track && pub.track.kind === Track.Kind.Audio) {
                attachAgentAudioTrack(pub.track, remoteParticipant);
              }
            }
          } else {
            // Explicitly ensure non-agent tracks are NEVER subscribed
            for (const pub of remoteParticipant.audioTrackPublications.values()) {
              pub.setSubscribed(false);
            }
          }
        }
      } catch (err: unknown) {
        console.error('LiveKit connection error:', err);
        const errorMsg = (err as Error).message || 'Failed to connect to LiveKit';
        setErrorMessage(errorMsg);
        setConnectionStatus('error');
        setIsLiveMode(false);
      } finally {
        isConnectingRef.current = false;
      }
    },
    [addEvent, attachAgentAudioTrack, cleanupAgentAudio, detachAgentAudioTrack, isAgentParticipant, startVolumeMonitor, stopVolumeMonitor],
  );

  // Disconnect from LiveKit room
  const disconnect = useCallback(async () => {
    stopVolumeMonitor();
    cleanupAgentAudio();
    if (roomRef.current) {
      await roomRef.current.disconnect();
      roomRef.current = null;
    }
    interruptedGensRef.current.clear();
    agentSegmentsRef.current.clear();
    acceptedGensRef.current.clear();
    hasTurnStartedRef.current = false;
    setConnectionStatus('disconnected');
    setIsMicActive(false);
    setIsUserSpeaking(false);
    setIsAgentSpeaking(false);
    setInterruptionNotice(null);
  }, [cleanupAgentAudio, stopVolumeMonitor]);

  // Toggle microphone mute/unmute
  const toggleMicrophone = useCallback(async () => {
    if (!roomRef.current || roomRef.current.state !== ConnectionState.Connected) {
      // Connect if not connected
      await connect(roomName);
      return;
    }

    try {
      const isEnabled = roomRef.current.localParticipant.isMicrophoneEnabled;
      await roomRef.current.localParticipant.setMicrophoneEnabled(!isEnabled);
      setIsMicActive(!isEnabled);
      setMicPermissionError(null);

      if (!isEnabled) {
        startVolumeMonitor();
        addEvent('LISTENING', activeGenIdRef.current, 'Microphone unmuted', undefined, 'livekit');
      } else {
        stopVolumeMonitor();
        addEvent('LISTENING', activeGenIdRef.current, 'Microphone muted', undefined, 'livekit');
      }
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setMicPermissionError(`Failed to toggle microphone: ${errObj.message || 'Unknown error'}`);
    }
  }, [connect, roomName, addEvent, startVolumeMonitor, stopVolumeMonitor]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopVolumeMonitor();
      cleanupAgentAudio();
      if (roomRef.current) {
        void roomRef.current.disconnect();
      }
      if (demoTimerRef.current) {
        clearTimeout(demoTimerRef.current);
      }
    };
  }, [cleanupAgentAudio, stopVolumeMonitor]);

  // ==========================================
  // Demo Simulation Triggers (Explicitly Tagged as Simulation)
  // ==========================================

  const triggerDemoNormalTurn = useCallback(() => {
    if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
    setInterruptionNotice(null);

    const nextGenId = activeGenIdRef.current + 1;
    setActiveGenerationId(nextGenId);
    setAgentState('THINKING');

    const query = 'What makes VoiceFlow interruption safe?';
    setCurrentUserTranscript(query);

    setActiveGen({
      id: nextGenId,
      status: 'active',
      query,
      startedAt: Date.now(),
      source: 'simulation',
    });

    addEvent(
      'GENERATION_STARTED',
      nextGenId,
      `[SIMULATION] User turn: "${query}"`,
      undefined,
      'simulation',
    );

    demoTimerRef.current = setTimeout(() => {
      setCurrentUserTranscript('');
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-sim-u-${Date.now()}`,
          role: 'user',
          content: query,
          generationId: nextGenId,
          timestamp: Date.now(),
        },
      ]);

      addEvent('RESULT_ACCEPTED', nextGenId, '[SIMULATION] LLM completion ready', undefined, 'simulation');
      setAgentState('SPEAKING');

      const response =
        'VoiceFlow uses monotonic generation IDs and AbortSignal cancellation to fence late tool results, ensuring Rime TTS only speaks current requests.';

      setMessages((prev) => [
        ...prev,
        {
          id: `msg-sim-a-${Date.now()}`,
          role: 'agent',
          content: response,
          generationId: nextGenId,
          timestamp: Date.now(),
        },
      ]);

      addEvent('SPEAKING', nextGenId, '[SIMULATION] Rime Coda audio playout', undefined, 'simulation');

      demoTimerRef.current = setTimeout(() => {
        setAgentState('LISTENING');
        addEvent('LISTENING', nextGenId, '[SIMULATION] Ready for next turn', undefined, 'simulation');
      }, 2500);
    }, 700);
  }, [addEvent]);

  const triggerDemoSlowAnalysis = useCallback(() => {
    if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
    setInterruptionNotice(null);

    const nextGenId = activeGenIdRef.current + 1;
    setActiveGenerationId(nextGenId);
    setAgentState('PROCESSING_TOOL');

    const query = 'Run heavy analysis on financial datasets with an 8 second delay';
    setCurrentUserTranscript(query);

    setActiveGen({
      id: nextGenId,
      status: 'active',
      query,
      startedAt: Date.now(),
      toolRunning: true,
      toolQuery: 'slow_analysis(delayMs: 8000)',
      source: 'simulation',
    });

    addEvent(
      'GENERATION_STARTED',
      nextGenId,
      '[SIMULATION] Long-running tool requested',
      undefined,
      'simulation',
    );
    addEvent(
      'TOOL_RUNNING',
      nextGenId,
      '[SIMULATION] slow_analysis active: 8000ms deliberate delay',
      undefined,
      'simulation',
    );

    demoTimerRef.current = setTimeout(() => {
      setCurrentUserTranscript('');
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-sim-u-${Date.now()}`,
          role: 'user',
          content: query,
          generationId: nextGenId,
          timestamp: Date.now(),
        },
      ]);
    }, 500);

    demoTimerRef.current = setTimeout(() => {
      addEvent(
        'RESULT_ACCEPTED',
        nextGenId,
        '[SIMULATION] Slow analysis completed successfully',
        undefined,
        'simulation',
      );
      setAgentState('SPEAKING');
      setActiveGen((prev) => ({
        ...prev,
        toolRunning: false,
        resultSummary: 'Processed 56 dataset rows',
      }));

      setMessages((prev) => [
        ...prev,
        {
          id: `msg-sim-a-${Date.now()}`,
          role: 'agent',
          content:
            'Analysis completed: processed 56 financial dataset items successfully under generation ' +
            nextGenId +
            '.',
          generationId: nextGenId,
          timestamp: Date.now(),
        },
      ]);

      demoTimerRef.current = setTimeout(() => {
        setAgentState('LISTENING');
        addEvent('LISTENING', nextGenId, '[SIMULATION] Ready for next turn', undefined, 'simulation');
      }, 3000);
    }, 8000);
  }, [addEvent]);

  const triggerDemoBargeIn = useCallback(() => {
    if (demoTimerRef.current) {
      clearTimeout(demoTimerRef.current);
      demoTimerRef.current = null;
    }

    const interruptedId = activeGenIdRef.current;
    interruptedGensRef.current.add(interruptedId);
    hasTurnStartedRef.current = false;
    const newGenId = interruptedId + 1;

    setAgentState('INTERRUPTED');
    setInterruptionNotice(
      `Barge-In Detected: Generation #${interruptedId} Invalidated & Tool Cancelled`,
    );

    setMessages((prev) =>
      prev.map((m) =>
        m.generationId === interruptedId && m.role === 'agent'
          ? { ...m, interrupted: true }
          : m,
      ),
    );

    addEvent(
      'INTERRUPTED',
      interruptedId,
      '[SIMULATION] User barge-in detected: speech stopped',
      'user_barge_in',
      'simulation',
    );
    addEvent(
      'REQUEST_INVALIDATED',
      interruptedId,
      '[SIMULATION] Generation controller aborted',
      'user_barge_in',
      'simulation',
    );

    setPreviousGen({
      ...activeGen,
      id: interruptedId,
      status: 'interrupted',
      toolRunning: false,
      endedAt: Date.now(),
      discardReason: 'RESULT_DISCARDED (stale_generation)',
      source: 'simulation',
    });

    const newQuery = 'Stop that, tell me a quick joke instead.';
    setCurrentUserTranscript(newQuery);
    setActiveGenerationId(newGenId);

    setActiveGen({
      id: newGenId,
      status: 'active',
      query: newQuery,
      startedAt: Date.now(),
      source: 'simulation',
    });

    addEvent(
      'GENERATION_STARTED',
      newGenId,
      `[SIMULATION] New turn started: "${newQuery}"`,
      undefined,
      'simulation',
    );

    demoTimerRef.current = setTimeout(() => {
      addEvent(
        'RESULT_DISCARDED',
        interruptedId,
        `[SIMULATION] fenceResult(${interruptedId}): stale output rejected`,
        'stale_generation',
        'simulation',
      );
    }, 400);

    demoTimerRef.current = setTimeout(() => {
      setCurrentUserTranscript('');
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-sim-u-${Date.now()}`,
          role: 'user',
          content: newQuery,
          generationId: newGenId,
          timestamp: Date.now(),
        },
      ]);

      addEvent('RESULT_ACCEPTED', newGenId, '[SIMULATION] Joke generated for new turn', undefined, 'simulation');
      setAgentState('SPEAKING');

      const joke = 'Why do programmers prefer dark mode? Because light attracts bugs!';

      setMessages((prev) => [
        ...prev,
        {
          id: `msg-sim-a-${Date.now()}`,
          role: 'agent',
          content: joke,
          generationId: newGenId,
          timestamp: Date.now(),
        },
      ]);

      addEvent('SPEAKING', newGenId, '[SIMULATION] Rime Coda spoke the new response', undefined, 'simulation');

      demoTimerRef.current = setTimeout(() => {
        setAgentState('LISTENING');
        setInterruptionNotice(null);
        addEvent('LISTENING', newGenId, '[SIMULATION] Agent returned to listening', undefined, 'simulation');
      }, 3500);
    }, 900);
  }, [activeGen, addEvent]);

  const resetDemoSession = useCallback(() => {
    if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
    interruptedGensRef.current.clear();
    agentSegmentsRef.current.clear();
    acceptedGensRef.current.clear();
    hasTurnStartedRef.current = false;
    setActiveGenerationId(101);
    setAgentState('LISTENING');
    setInterruptionNotice(null);
    setCurrentUserTranscript('');
    setPreviousGen(null);
    setActiveGen({
      id: 101,
      status: 'active',
      query: 'Ready for voice input',
      startedAt: Date.now(),
      source: isLiveMode ? 'livekit' : 'simulation',
    });
    setMessages([]);
    setEvents([
      {
        id: `ev-${Date.now()}`,
        timestamp: Date.now(),
        state: 'LISTENING',
        generationId: 101,
        details: 'Session reset. Ready for voice or demo input.',
        source: isLiveMode ? 'livekit' : 'simulation',
      },
    ]);
  }, [isLiveMode]);

  return {
    connectionStatus,
    roomName,
    agentState,
    activeGenerationId,
    isMicActive,
    isUserSpeaking,
    isAgentSpeaking,
    interruptionNotice,
    errorMessage,
    micPermissionError,
    audioVolume,
    activeGen,
    previousGen,
    messages,
    events,
    currentUserTranscript,
    isLiveMode,
    connect,
    disconnect,
    toggleMicrophone,
    clearEvents: () => setEvents([]),
    triggerDemoNormalTurn,
    triggerDemoSlowAnalysis,
    triggerDemoBargeIn,
    resetDemoSession,
  };
}
