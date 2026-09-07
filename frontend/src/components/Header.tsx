import React from 'react';
import { Radio, ShieldCheck, Activity, Cpu, Volume2 } from 'lucide-react';
import { ConnectionStatus } from '../types';

interface HeaderProps {
  status: ConnectionStatus;
  roomName: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ status, roomName, onConnect, onDisconnect }) => {
  const getStatusDisplay = () => {
    switch (status) {
      case 'connected':
        return {
          color: 'var(--color-green)',
          bg: 'rgba(16, 185, 129, 0.12)',
          border: 'rgba(16, 185, 129, 0.3)',
          label: `Live: ${roomName}`,
          dotShadow: '0 0 10px var(--color-green)',
        };
      case 'connecting':
        return {
          color: 'var(--color-cyan)',
          bg: 'rgba(0, 240, 255, 0.12)',
          border: 'rgba(0, 240, 255, 0.3)',
          label: 'Connecting...',
          dotShadow: '0 0 10px var(--color-cyan)',
        };
      case 'error':
        return {
          color: 'var(--color-red)',
          bg: 'rgba(239, 68, 68, 0.15)',
          border: 'rgba(239, 68, 68, 0.4)',
          label: 'Connection Failed',
          dotShadow: '0 0 10px var(--color-red)',
        };
      case 'disconnected':
      default:
        return {
          color: '#94a3b8',
          bg: 'rgba(148, 163, 184, 0.1)',
          border: 'rgba(148, 163, 184, 0.25)',
          label: 'Disconnected',
          dotShadow: 'none',
        };
    }
  };

  const statusDisplay = getStatusDisplay();

  return (
    <header className="glass-panel" style={{ padding: '16px 24px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        
        {/* Brand & Tagline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(0, 240, 255, 0.2), rgba(168, 85, 247, 0.2))',
              border: '1px solid var(--border-glow)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ShieldCheck size={26} color="var(--color-cyan)" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', background: 'linear-gradient(90deg, #ffffff, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                VoiceFlow
              </h1>
              <span className="mono" style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.06)', color: 'var(--text-dim)', border: '1px solid var(--border-color)' }}>
                v0.1.0 • Hackathon Edition
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: '2px', fontWeight: 500 }}>
              Interruption-Safe Real-Time Voice Agent
            </p>
          </div>
        </div>

        {/* Technology Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div className="glass-panel mono" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.75rem', borderRadius: '8px', background: 'rgba(0, 0, 0, 0.4)' }}>
            <Radio size={14} color="#3b82f6" />
            <span style={{ color: '#cbd5e1' }}>LiveKit Agents 1.8</span>
          </div>

          <div className="glass-panel mono" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.75rem', borderRadius: '8px', background: 'rgba(0, 0, 0, 0.4)' }}>
            <Activity size={14} color="#10b981" />
            <span style={{ color: '#cbd5e1' }}>Inference STT</span>
          </div>

          <div className="glass-panel mono" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.75rem', borderRadius: '8px', background: 'rgba(0, 0, 0, 0.4)' }}>
            <Cpu size={14} color="#f59e0b" />
            <span style={{ color: '#cbd5e1' }}>Gemma 4 31B</span>
          </div>

          <div className="glass-panel mono" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.75rem', borderRadius: '8px', background: 'rgba(0, 0, 0, 0.4)' }}>
            <Volume2 size={14} color="#00f0ff" />
            <span style={{ color: '#00f0ff', fontWeight: 600 }}>Inference TTS</span>
          </div>
        </div>

        {/* Live Status & Connection Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: '20px',
              background: statusDisplay.bg,
              border: `1px solid ${statusDisplay.border}`,
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: statusDisplay.color,
                boxShadow: statusDisplay.dotShadow,
              }}
            />
            <span className="mono" style={{ fontSize: '0.8rem', color: statusDisplay.color, fontWeight: 600 }}>
              {statusDisplay.label}
            </span>
          </div>

          {status === 'connected' ? (
            <button
              onClick={onDisconnect}
              className="mono"
              style={{
                padding: '6px 12px',
                fontSize: '0.75rem',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
                cursor: 'pointer',
              }}
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={onConnect}
              disabled={status === 'connecting'}
              className="mono"
              style={{
                padding: '6px 14px',
                fontSize: '0.75rem',
                borderRadius: '8px',
                background: status === 'connecting' ? 'rgba(0, 240, 255, 0.05)' : 'rgba(0, 240, 255, 0.15)',
                border: '1px solid rgba(0, 240, 255, 0.4)',
                color: 'var(--color-cyan)',
                cursor: status === 'connecting' ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              {status === 'connecting' ? 'Connecting...' : 'Connect Live'}
            </button>
          )}
        </div>

      </div>
    </header>
  );
};
