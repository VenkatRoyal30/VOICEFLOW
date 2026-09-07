import React from 'react';
import { ShieldCheck, Cpu, Ban, Zap } from 'lucide-react';
import { GenerationInfo } from '../types';

interface GenerationCardProps {
  activeGen: GenerationInfo;
  previousGen?: GenerationInfo | null;
}

export const GenerationCard: React.FC<GenerationCardProps> = ({ activeGen, previousGen }) => {
  const getSourceBadge = (source?: string) => {
    switch (source) {
      case 'backend':
        return {
          label: 'REAL BACKEND DATA',
          color: 'var(--color-green)',
          bg: 'rgba(16, 185, 129, 0.15)',
          border: 'rgba(16, 185, 129, 0.4)',
        };
      case 'simulation':
        return {
          label: 'OFFLINE SIMULATION',
          color: 'var(--color-amber)',
          bg: 'rgba(245, 158, 11, 0.15)',
          border: 'rgba(245, 158, 11, 0.4)',
        };
      case 'livekit':
      default:
        return {
          label: 'LIVE WEBRTC SESSION',
          color: 'var(--color-cyan)',
          bg: 'rgba(0, 240, 255, 0.15)',
          border: 'rgba(0, 240, 255, 0.4)',
        };
    }
  };

  const sourceBadge = getSourceBadge(activeGen.source);

  return (
    <div className="glass-panel" style={{ padding: '20px', marginBottom: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Zap size={16} color="var(--color-cyan)" />
          <span>Generation Coordinator & Stale Fence</span>
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            className="mono"
            style={{
              fontSize: '0.7rem',
              padding: '2px 8px',
              borderRadius: '4px',
              fontWeight: 700,
              backgroundColor: sourceBadge.bg,
              color: sourceBadge.color,
              border: `1px solid ${sourceBadge.border}`,
            }}
          >
            {sourceBadge.label}
          </span>
          <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
            State Machine Inspector
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: previousGen ? '1fr 1fr' : '1fr', gap: '14px' }}>
        
        {/* Active Generation Box */}
        <div
          style={{
            padding: '16px',
            borderRadius: '12px',
            background: activeGen.status === 'interrupted' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(0, 240, 255, 0.06)',
            border: `1px solid ${activeGen.status === 'interrupted' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(0, 240, 255, 0.3)'}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600 }}>
              CURRENT GENERATION
            </span>
            <span
              className="mono"
              style={{
                fontSize: '0.7rem',
                padding: '2px 8px',
                borderRadius: '4px',
                fontWeight: 700,
                backgroundColor: activeGen.status === 'interrupted' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                color: activeGen.status === 'interrupted' ? 'var(--color-red)' : 'var(--color-green)',
              }}
            >
              {activeGen.status === 'interrupted' ? 'INVALIDATED' : 'VALID / ACTIVE'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span className="mono" style={{ fontSize: '1.6rem', fontWeight: 800, color: activeGen.status === 'interrupted' ? 'var(--color-red)' : 'var(--color-cyan)' }}>
              #{activeGen.id}
            </span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              "{activeGen.query || 'Listening for speech...'}"
            </span>
          </div>

          {activeGen.toolRunning && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', fontSize: '0.75rem', color: 'var(--color-amber)' }}>
              <Cpu size={14} />
              <span className="mono">Tool: {activeGen.toolQuery || 'slow_analysis in flight...'}</span>
            </div>
          )}

          {activeGen.resultSummary && (
            <div style={{ fontSize: '0.8rem', color: 'var(--color-green)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={14} />
              <span>RESULT_ACCEPTED by VoiceFlow fence</span>
            </div>
          )}
        </div>

        {/* Superseded / Interrupted Generation Box (if exists) */}
        {previousGen && (
          <div
            style={{
              padding: '16px',
              borderRadius: '12px',
              background: 'rgba(239, 68, 68, 0.05)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600 }}>
                SUPERSEDED GENERATION
              </span>
              <span
                className="mono"
                style={{
                  fontSize: '0.7rem',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontWeight: 700,
                  backgroundColor: 'rgba(239, 68, 68, 0.2)',
                  color: 'var(--color-red)',
                }}
              >
                FENCED / DISCARDED
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span className="mono" style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-red)', textDecoration: 'line-through' }}>
                #{previousGen.id}
              </span>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                "{previousGen.query}"
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', fontSize: '0.75rem', color: 'var(--color-red)' }}>
              <Ban size={14} />
              <span className="mono">
                {previousGen.discardReason || 'RESULT_DISCARDED (stale_generation)'}
              </span>
            </div>

            <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
              Stale result prevented from poisoning LLM context or reaching Rime TTS.
            </div>
          </div>
        )}

      </div>

      <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid var(--border-color)', fontSize: '0.75rem', color: 'var(--text-faint)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <span>
          {activeGen.source === 'simulation'
            ? 'ℹ️ Presentation Simulation Mode: Demonstrates abort and stale-result fencing without requiring live audio.'
            : 'ℹ️ Real LiveKit Audio Session: Speech turns trigger Deepgram STT, Ollama inference, and Rime Coda playback.'}
        </span>
        <span className="mono">backend/src/coordinator.ts</span>
      </div>
    </div>
  );
};
