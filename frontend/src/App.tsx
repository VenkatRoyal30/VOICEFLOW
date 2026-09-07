import React, { useEffect } from 'react';
import { Header } from './components/Header';
import { VoiceVisualizer } from './components/VoiceVisualizer';
import { ConversationView } from './components/ConversationView';
import { GenerationCard } from './components/GenerationCard';
import { EventLog } from './components/EventLog';
import { DemoControls } from './components/DemoControls';
import { useLiveKitVoice } from './useLiveKitVoice';
import { AlertTriangle, Wifi } from 'lucide-react';

export const App: React.FC = () => {
  const {
    connectionStatus,
    roomName,
    agentState,
    activeGenerationId,
    isMicActive,
    isUserSpeaking,
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
    clearEvents,
    triggerDemoNormalTurn,
    triggerDemoSlowAnalysis,
    triggerDemoBargeIn,
    resetDemoSession,
  } = useLiveKitVoice();

  // Attempt auto-connect on mount if desired or ready
  useEffect(() => {
    // Attempt non-blocking initial connection to local token server
    void connect().catch(() => {
      // Gracefully handled in useLiveKitVoice
    });
  }, [connect]);

  return (
    <div style={{ maxWidth: '1360px', margin: '0 auto', padding: '24px 16px', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* Header with connection controls */}
      <Header
        status={connectionStatus}
        roomName={roomName}
        onConnect={() => void connect()}
        onDisconnect={() => void disconnect()}
      />

      {/* Global Connection / Token Error Banner */}
      {errorMessage && (
        <div
          style={{
            marginBottom: '20px',
            padding: '12px 18px',
            borderRadius: '10px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#fecaca',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertTriangle size={18} color="var(--color-red)" style={{ flexShrink: 0 }} />
            <span style={{ whiteSpace: 'pre-line' }}>{errorMessage}</span>
          </div>
          <button
            onClick={() => void connect()}
            className="mono"
            style={{
              padding: '6px 14px',
              background: 'rgba(239, 68, 68, 0.25)',
              border: '1px solid rgba(239, 68, 68, 0.5)',
              color: '#ffffff',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Live Mode Ready Indicator */}
      {connectionStatus === 'connected' && (
        <div
          style={{
            marginBottom: '16px',
            padding: '8px 16px',
            borderRadius: '8px',
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            color: '#a7f3d0',
            fontSize: '0.8rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
          className="mono"
        >
          <Wifi size={14} color="var(--color-green)" />
          <span>Live WebRTC audio active: speak directly into your microphone to chat with VoiceFlow.</span>
        </div>
      )}

      {/* Main Grid */}
      <main style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 1fr) minmax(420px, 1.35fr)', gap: '24px', flex: 1 }}>
        
        {/* Left Column: Voice Core & Turn Stream */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <VoiceVisualizer
            state={agentState}
            activeGenerationId={activeGenerationId}
            isMicActive={isMicActive}
            onToggleMic={() => void toggleMicrophone()}
            interruptionNotice={interruptionNotice}
            connectionStatus={connectionStatus}
            micPermissionError={micPermissionError}
            audioVolume={audioVolume}
            isUserSpeaking={isUserSpeaking}
          />

          <ConversationView
            messages={messages}
            currentUserQuery={currentUserTranscript}
            isProcessing={agentState === 'PROCESSING_TOOL' || agentState === 'THINKING'}
          />
        </section>

        {/* Right Column: Generation Coordinator & Event Timeline */}
        <section style={{ display: 'flex', flexDirection: 'column' }}>
          <GenerationCard
            activeGen={activeGen}
            previousGen={previousGen}
          />

          <EventLog
            events={events}
            onClear={clearEvents}
          />

          <DemoControls
            currentState={agentState}
            onTriggerNormalTurn={triggerDemoNormalTurn}
            onTriggerSlowAnalysis={triggerDemoSlowAnalysis}
            onTriggerBargeIn={triggerDemoBargeIn}
            onReset={resetDemoSession}
            isLiveMode={isLiveMode}
          />
        </section>

      </main>

      {/* Footer */}
      <footer style={{ marginTop: '32px', textAlign: 'center', color: 'var(--text-faint)', fontSize: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }} className="mono">
        VoiceFlow • DataForge 2026 Rime Hackathon Submission • LiveKit Agents 1.8.0 • Deepgram Nova-3 • Ollama Llama 3.2 • Rime Coda TTS
      </footer>

    </div>
  );
};

export default App;
