import React from 'react';
import { Terminal, ShieldX, ShieldCheck, Play, Radio, Volume2, AlertTriangle, Cpu } from 'lucide-react';
import { CoordinatorEvent } from '../types';

interface EventLogProps {
  events: CoordinatorEvent[];
  onClear?: () => void;
}

export const EventLog: React.FC<EventLogProps> = ({ events, onClear }) => {
  const getEventBadge = (state: CoordinatorEvent['state']) => {
    switch (state) {
      case 'GENERATION_STARTED':
        return { icon: <Play size={13} />, color: 'var(--color-cyan)', text: 'GENERATION_STARTED' };
      case 'TOOL_RUNNING':
        return { icon: <Cpu size={13} />, color: 'var(--color-amber)', text: 'TOOL_RUNNING' };
      case 'INTERRUPTED':
        return { icon: <AlertTriangle size={13} />, color: 'var(--color-red)', text: 'INTERRUPTED' };
      case 'REQUEST_INVALIDATED':
        return { icon: <ShieldX size={13} />, color: 'var(--color-red)', text: 'REQUEST_INVALIDATED' };
      case 'RESULT_DISCARDED':
        return { icon: <ShieldX size={13} />, color: '#ec4899', text: 'RESULT_DISCARDED' };
      case 'RESULT_ACCEPTED':
        return { icon: <ShieldCheck size={13} />, color: 'var(--color-green)', text: 'RESULT_ACCEPTED' };
      case 'SPEAKING':
        return { icon: <Volume2 size={13} />, color: 'var(--color-green)', text: 'SPEAKING' };
      case 'CONNECTED':
        return { icon: <ShieldCheck size={13} />, color: 'var(--color-cyan)', text: 'CONNECTED' };
      case 'DISCONNECTED':
        return { icon: <AlertTriangle size={13} />, color: 'var(--text-faint)', text: 'DISCONNECTED' };
      case 'LISTENING':
      default:
        return { icon: <Radio size={13} />, color: 'var(--color-blue)', text: 'LISTENING' };
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '340px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
        <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Terminal size={16} color="var(--color-cyan)" />
          <span>Real-Time Coordinator Event Log</span>
        </h2>
        {onClear && (
          <button
            onClick={onClear}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-faint)',
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
            className="mono"
          >
            Clear
          </button>
        )}
      </div>

      {/* Event Stream */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
        {events.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-faint)', fontSize: '0.8rem' }} className="mono">
            Waiting for coordinator events...
          </div>
        ) : (
          events.map((ev) => {
            const badge = getEventBadge(ev.state);
            const timeStr = new Date(ev.timestamp).toLocaleTimeString([], {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }) + '.' + String(ev.timestamp % 1000).padStart(3, '0');

            return (
              <div
                key={ev.id}
                className="mono"
                style={{
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: 'rgba(0, 0, 0, 0.35)',
                  border: `1px solid ${ev.state.includes('INTERRUPTED') || ev.state.includes('DISCARDED') ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.04)'}`,
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                  <span style={{ color: 'var(--text-faint)', minWidth: '76px' }}>{timeStr}</span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      color: badge.color,
                      fontWeight: 600,
                      minWidth: '160px',
                    }}
                  >
                    {badge.icon}
                    {badge.text}
                  </span>
                  {ev.details && (
                    <span style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ev.details}
                    </span>
                  )}
                  {ev.reason && (
                    <span style={{ color: 'var(--color-red)', fontWeight: 500 }}>
                      reason: {ev.reason}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: '0.65rem',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      backgroundColor:
                        ev.source === 'backend'
                          ? 'rgba(16, 185, 129, 0.2)'
                          : ev.source === 'simulation'
                          ? 'rgba(245, 158, 11, 0.2)'
                          : 'rgba(0, 240, 255, 0.15)',
                      color:
                        ev.source === 'backend'
                          ? 'var(--color-green)'
                          : ev.source === 'simulation'
                          ? 'var(--color-amber)'
                          : 'var(--color-cyan)',
                      fontWeight: 700,
                    }}
                  >
                    {ev.source === 'backend' ? 'BACKEND' : ev.source === 'simulation' ? 'DEMO' : 'WEBRTC'}
                  </span>
                  <span
                    style={{
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: 'rgba(255, 255, 255, 0.06)',
                      color: 'var(--text-dim)',
                      fontSize: '0.7rem',
                    }}
                  >
                    Gen #{ev.generationId}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
