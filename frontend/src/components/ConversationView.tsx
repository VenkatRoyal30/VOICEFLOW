import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { ChatMessage } from '../types';

interface ConversationViewProps {
  messages: ChatMessage[];
  currentUserQuery?: string;
  isProcessing?: boolean;
}

export const ConversationView: React.FC<ConversationViewProps> = ({
  messages,
  currentUserQuery,
  isProcessing,
}) => {
  return (
    <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '340px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
        <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>Conversational Turn Stream</span>
        </h2>
        <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
          Deepgram STT ➔ Rime TTS
        </span>
      </div>

      {/* Message List */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '4px' }}>
        {messages.length === 0 && !currentUserQuery && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-faint)', fontSize: '0.85rem' }}>
            No conversation turns yet. Tap the microphone or run a demo scenario below to start.
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '82%',
            }}
          >
            {/* Header info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>
                {msg.role === 'user' ? 'USER' : 'VOICEFLOW (Rime Coda)'}
              </span>
              <span
                className="mono"
                style={{
                  fontSize: '0.65rem',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  background: msg.interrupted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(0, 240, 255, 0.1)',
                  color: msg.interrupted ? 'var(--color-red)' : 'var(--color-cyan)',
                  border: `1px solid ${msg.interrupted ? 'rgba(239, 68, 68, 0.3)' : 'rgba(0, 240, 255, 0.2)'}`,
                }}
              >
                Gen #{msg.generationId}
              </span>
            </div>

            {/* Message Bubble */}
            <div
              style={{
                padding: '10px 14px',
                borderRadius: msg.role === 'user' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                background: msg.interrupted
                  ? 'rgba(239, 68, 68, 0.12)'
                  : msg.role === 'user'
                  ? 'rgba(59, 130, 246, 0.15)'
                  : 'rgba(24, 32, 48, 0.85)',
                border: `1px solid ${
                  msg.interrupted
                    ? 'rgba(239, 68, 68, 0.35)'
                    : msg.role === 'user'
                    ? 'rgba(59, 130, 246, 0.3)'
                    : 'var(--border-color)'
                }`,
                color: msg.interrupted ? '#fca5a5' : 'var(--text-main)',
                fontSize: '0.9rem',
                lineHeight: 1.45,
                position: 'relative',
              }}
            >
              {msg.content}

              {msg.interrupted && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px', fontSize: '0.75rem', color: 'var(--color-red)' }}>
                  <AlertTriangle size={12} />
                  <span>Turn cut off by user barge-in</span>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* In-flight user request */}
        {currentUserQuery && (
          <div style={{ display: 'flex', flexDirection: 'column', alignSelf: 'flex-end', maxWidth: '82%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', alignSelf: 'flex-end' }}>
              <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--color-cyan)' }}>
                USER (TRANSCRIBING...)
              </span>
            </div>
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '14px 14px 2px 14px',
                background: 'rgba(0, 240, 255, 0.1)',
                border: '1px solid rgba(0, 240, 255, 0.4)',
                color: 'var(--text-main)',
                fontSize: '0.9rem',
              }}
            >
              {currentUserQuery}
            </div>
          </div>
        )}

        {/* Processing Indicator */}
        {isProcessing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-amber)', fontSize: '0.8rem', padding: '6px 0' }}>
            <span className="mono">Agent is processing tool request...</span>
          </div>
        )}
      </div>
    </div>
  );
};
