import React from 'react';
import { Mic, MicOff, AlertOctagon, Sparkles, Loader2, Volume2, Radio, AlertTriangle } from 'lucide-react';
import { AgentState, ConnectionStatus } from '../types';

interface VoiceVisualizerProps {
  state: AgentState;
  activeGenerationId: number;
  isMicActive: boolean;
  onToggleMic: () => void;
  interruptionNotice?: string | null;
  connectionStatus: ConnectionStatus;
  micPermissionError?: string | null;
  audioVolume?: number;
  isUserSpeaking?: boolean;
}

export const VoiceVisualizer: React.FC<VoiceVisualizerProps> = ({
  state,
  activeGenerationId,
  isMicActive,
  onToggleMic,
  interruptionNotice,
  connectionStatus,
  micPermissionError,
  audioVolume = 0,
  isUserSpeaking = false,
}) => {
  // State colors & configurations
  const getStateInfo = () => {
    if (connectionStatus === 'connecting') {
      return {
        label: 'Connecting to LiveKit...',
        color: 'var(--color-cyan)',
        glow: 'var(--shadow-glow-cyan)',
        badgeClass: 'badge-thinking',
        icon: <Loader2 size={20} className="anim-spin" />,
      };
    }

    if (connectionStatus === 'error') {
      return {
        label: 'Connection Error',
        color: 'var(--color-red)',
        glow: 'var(--shadow-glow-red)',
        badgeClass: 'badge-interrupted',
        icon: <AlertOctagon size={20} />,
      };
    }

    if (connectionStatus === 'disconnected') {
      return {
        label: 'Disconnected (Click Mic to Start)',
        color: '#94a3b8',
        glow: 'none',
        badgeClass: 'badge-thinking',
        icon: <Radio size={20} />,
      };
    }

    switch (state) {
      case 'SPEAKING':
        return {
          label: 'Speaking (Rime Coda)',
          color: 'var(--color-green)',
          glow: 'var(--shadow-glow-green)',
          badgeClass: 'badge-speaking',
          icon: <Volume2 size={20} className="mono" />,
        };
      case 'PROCESSING_TOOL':
        return {
          label: 'Executing slow_analysis Tool',
          color: 'var(--color-amber)',
          glow: '0 0 35px rgba(245, 158, 11, 0.3)',
          badgeClass: 'badge-thinking',
          icon: <Loader2 size={20} className="anim-spin" />,
        };
      case 'THINKING':
        return {
          label: 'Thinking (Ollama LLM)',
          color: 'var(--color-purple)',
          glow: '0 0 35px rgba(168, 85, 247, 0.3)',
          badgeClass: 'badge-fenced',
          icon: <Sparkles size={20} />,
        };
      case 'INTERRUPTED':
        return {
          label: 'Barge-In: Speech Cutoff & Invalidation',
          color: 'var(--color-red)',
          glow: 'var(--shadow-glow-red)',
          badgeClass: 'badge-interrupted',
          icon: <AlertOctagon size={20} />,
        };
      case 'LISTENING':
      default:
        return {
          label: isUserSpeaking ? 'User Speaking (Voice Detected)' : 'Listening (Deepgram STT)',
          color: 'var(--color-cyan)',
          glow: 'var(--shadow-glow-cyan)',
          badgeClass: 'badge-active',
          icon: <Mic size={20} />,
        };
    }
  };

  const stateInfo = getStateInfo();

  const getButtonContent = () => {
    if (connectionStatus === 'connecting') {
      return {
        icon: <Loader2 size={42} color="var(--color-cyan)" className="anim-spin" />,
        text: 'CONNECTING...',
        title: 'Connecting to LiveKit room...',
      };
    }
    if (connectionStatus === 'error') {
      return {
        icon: <AlertOctagon size={42} color="var(--color-red)" />,
        text: 'RETRY CONNECT',
        title: 'Click to retry connecting',
      };
    }
    if (connectionStatus === 'disconnected') {
      return {
        icon: <Mic size={42} color="var(--color-cyan)" />,
        text: 'CONNECT & TALK',
        title: 'Click to connect to LiveKit and speak with VoiceFlow',
      };
    }
    if (!isMicActive) {
      return {
        icon: <MicOff size={42} color="var(--text-faint)" />,
        text: 'MIC MUTED',
        title: 'Click to unmute microphone',
      };
    }
    if (state === 'SPEAKING') {
      return {
        icon: <Volume2 size={42} color="var(--color-green)" />,
        text: 'RIME SPEAKING',
        title: 'VoiceFlow is speaking. Speak to barge in.',
      };
    }
    if (isUserSpeaking) {
      return {
        icon: <Mic size={42} color="var(--color-cyan)" />,
        text: 'SPEAKING...',
        title: 'Microphone is streaming live audio',
      };
    }
    return {
      icon: <Mic size={42} color="var(--color-cyan)" />,
      text: 'LIVE MIC',
      title: 'Microphone active. Speak now or click to mute.',
    };
  };

  const buttonContent = getButtonContent();

  return (
    <div className="glass-panel" style={{ padding: '32px 24px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
      
      {/* Background ambient glow */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '280px',
          height: '280px',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${stateInfo.color} 0%, transparent 70%)`,
          opacity: state === 'INTERRUPTED' ? 0.25 : connectionStatus === 'connected' ? 0.15 : 0.05,
          transition: 'all 0.4s ease',
          pointerEvents: 'none',
        }}
      />

      {/* State Badge & Generation Pill */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginBottom: '28px', flexWrap: 'wrap' }}>
        <div className={`mono ${stateInfo.badgeClass}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 16px', borderRadius: '30px', fontWeight: 600, fontSize: '0.85rem' }}>
          {stateInfo.icon}
          <span>{stateInfo.label}</span>
        </div>

        <div className="glass-panel mono" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '30px', background: 'rgba(0, 0, 0, 0.3)' }}>
          <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>ACTIVE GEN:</span>
          <span style={{ color: state === 'INTERRUPTED' ? 'var(--color-red)' : 'var(--color-cyan)', fontWeight: 700, fontSize: '0.9rem' }}>
            #{activeGenerationId}
          </span>
        </div>
      </div>

      {/* Interactive Microphone Orb */}
      <div style={{ position: 'relative', width: '160px', height: '160px', margin: '0 auto 28px auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        
        {/* Pulsating outer halo */}
        <div
          className={
            state === 'INTERRUPTED'
              ? 'anim-pulse-red'
              : connectionStatus === 'connected' && isMicActive
              ? 'anim-pulse-cyan'
              : ''
          }
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: `2px solid ${stateInfo.color}`,
            opacity: 0.7,
            transition: 'border-color 0.3s ease',
          }}
        />

        {/* Center Mic Button */}
        <button
          onClick={onToggleMic}
          style={{
            width: '124px',
            height: '124px',
            borderRadius: '50%',
            background: state === 'INTERRUPTED'
              ? 'linear-gradient(135deg, #450a0a, #7f1d1d)'
              : state === 'SPEAKING'
              ? 'linear-gradient(135deg, #064e3b, #047857)'
              : connectionStatus === 'connected'
              ? 'linear-gradient(135deg, #091a28, #11283d)'
              : 'linear-gradient(135deg, #1e293b, #0f172a)',
            border: `2px solid ${stateInfo.color}`,
            color: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: stateInfo.glow,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            zIndex: 2,
          }}
          title={buttonContent.title}
        >
          {buttonContent.icon}
          <span className="mono" style={{ fontSize: '0.65rem', marginTop: '6px', letterSpacing: '0.05em', color: 'var(--text-dim)', fontWeight: 600 }}>
            {buttonContent.text}
          </span>
        </button>
      </div>

      {/* Audio Waveform Visualization */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', height: '48px', marginBottom: '16px' }}>
        {[20, 36, 48, 28, 44, 18, 38, 46, 24, 40, 16].map((baseHeight, i) => {
          let calculatedHeight = 8;
          if (state === 'SPEAKING') {
            calculatedHeight = baseHeight;
          } else if (state === 'LISTENING' && isMicActive) {
            if (audioVolume > 0.05) {
              calculatedHeight = Math.max(8, Math.min(50, Math.round(baseHeight * (0.3 + audioVolume * 1.5))));
            } else {
              calculatedHeight = Math.round(baseHeight * 0.4);
            }
          } else if (state === 'PROCESSING_TOOL') {
            calculatedHeight = (i % 3 + 1) * 12;
          }

          return (
            <div
              key={i}
              style={{
                width: '4px',
                borderRadius: '2px',
                backgroundColor: state === 'INTERRUPTED' ? 'var(--color-red)' : stateInfo.color,
                height: `${calculatedHeight}px`,
                transition: 'height 0.1s ease, background-color 0.3s ease',
                animation: (state === 'SPEAKING' || (state === 'LISTENING' && isMicActive && !audioVolume))
                  ? `bar-wave ${0.6 + (i % 5) * 0.15}s infinite ease-in-out`
                  : 'none',
              }}
            />
          );
        })}
      </div>

      {/* Interruption Alert Banner */}
      {interruptionNotice && (
        <div
          style={{
            margin: '12px auto 0 auto',
            maxWidth: '540px',
            padding: '10px 16px',
            borderRadius: '10px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#fca5a5',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            animation: 'pulse-red 1.5s ease-out',
          }}
        >
          <AlertOctagon size={16} color="var(--color-red)" />
          <span>{interruptionNotice}</span>
        </div>
      )}

      {/* Microphone Permission Error Banner */}
      {micPermissionError && (
        <div
          style={{
            margin: '16px auto 0 auto',
            maxWidth: '540px',
            padding: '12px 16px',
            borderRadius: '10px',
            background: 'rgba(239, 68, 68, 0.18)',
            border: '1px solid rgba(239, 68, 68, 0.5)',
            color: '#fecaca',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            textAlign: 'left',
          }}
        >
          <AlertTriangle size={20} color="var(--color-red)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontWeight: 700, color: '#ffffff', marginBottom: '2px' }}>Microphone Permission Required</div>
            <div>{micPermissionError}</div>
          </div>
        </div>
      )}
    </div>
  );
};
