import React from 'react';
import { AlertOctagon, RotateCcw, Sparkles, Clock } from 'lucide-react';
import { AgentState } from '../types';

interface DemoControlsProps {
  currentState: AgentState;
  onTriggerNormalTurn: () => void;
  onTriggerSlowAnalysis: () => void;
  onTriggerBargeIn: () => void;
  onReset: () => void;
  isLiveMode?: boolean;
}

export const DemoControls: React.FC<DemoControlsProps> = ({
  currentState,
  onTriggerNormalTurn,
  onTriggerSlowAnalysis,
  onTriggerBargeIn,
  onReset,
  isLiveMode = false,
}) => {
  const isBusy = currentState === 'PROCESSING_TOOL' || currentState === 'SPEAKING';

  return (
    <div className="glass-panel" style={{ padding: '20px', marginTop: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>Presentation Demo Controls</span>
            <span
              className="mono"
              style={{
                fontSize: '0.65rem',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: isLiveMode ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                color: isLiveMode ? 'var(--color-green)' : 'var(--color-amber)',
                border: `1px solid ${isLiveMode ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
              }}
            >
              {isLiveMode ? 'LIVE WEBRTC ACTIVE' : 'OFFLINE REHEARSAL'}
            </span>
          </h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '2px' }}>
            {isLiveMode
              ? 'Real microphone audio is streaming to LiveKit. You can speak naturally, or use these scenario triggers to demonstrate specific flows.'
              : 'Interactive triggers for testing VoiceFlow interruption safety and Rime playback without a live voice session.'}
          </p>
        </div>

        <button
          onClick={onReset}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '6px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-dim)',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
          className="mono"
        >
          <RotateCcw size={13} />
          <span>Reset Session</span>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
        
        {/* Scenario 1: Normal Query */}
        <button
          onClick={onTriggerNormalTurn}
          disabled={isBusy}
          style={{
            padding: '12px 14px',
            borderRadius: '10px',
            background: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.25)',
            color: '#93c5fd',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            cursor: isBusy ? 'not-allowed' : 'pointer',
            opacity: isBusy ? 0.5 : 1,
            textAlign: 'left',
            transition: 'all 0.2s ease',
          }}
        >
          <Sparkles size={18} color="#60a5fa" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>1. Normal Fast Turn</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '2px' }}>
              Sub-second conversational response
            </div>
          </div>
        </button>

        {/* Scenario 2: Heavy Task (Slow Analysis) */}
        <button
          onClick={onTriggerSlowAnalysis}
          disabled={isBusy}
          style={{
            padding: '12px 14px',
            borderRadius: '10px',
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            color: '#fde68a',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            cursor: isBusy ? 'not-allowed' : 'pointer',
            opacity: isBusy ? 0.5 : 1,
            textAlign: 'left',
            transition: 'all 0.2s ease',
          }}
        >
          <Clock size={18} color="#fbbf24" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>2. Trigger Slow Tool (8s)</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '2px' }}>
              Starts cancellable computation
            </div>
          </div>
        </button>

        {/* Scenario 3: Simulate Barge-in / Interruption */}
        <button
          onClick={onTriggerBargeIn}
          style={{
            padding: '12px 14px',
            borderRadius: '10px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#fca5a5',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            cursor: 'pointer',
            textAlign: 'left',
            boxShadow: '0 0 15px rgba(239, 68, 68, 0.15)',
            transition: 'all 0.2s ease',
          }}
        >
          <AlertOctagon size={18} color="var(--color-red)" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>3. Simulate User Barge-In</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '2px' }}>
              Immediate cutoff & stale fence
            </div>
          </div>
        </button>

      </div>
    </div>
  );
};
