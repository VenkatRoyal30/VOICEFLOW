# VoiceFlow Frontend Dashboard

The VoiceFlow Frontend is a modern React + TypeScript + Vite dashboard designed for presenting and demonstrating VoiceFlow's **interruption-safe realtime voice architecture** during the DataForge 2026 Rime Hackathon Challenge.

---

## Features

* **Realtime State Visualizer:** Animated voice visualizer reflecting agent states (`LISTENING`, `THINKING`, `PROCESSING_TOOL`, `SPEAKING`, and `INTERRUPTED`).
* **Generation Coordinator Inspector:** Live display of active generation IDs ($N$) alongside superseded generation IDs ($N-1$), showing the VoiceFlow `fenceResult()` discarding stale tool data.
* **Turn Stream:** Interactive transcript stream showing real-time speech-to-text recognition and Rime Coda text-to-speech output.
* **Structured Event Log:** Chronological telemetry feed mirroring the backend coordinator's transitions (`GENERATION_STARTED`, `TOOL_RUNNING`, `INTERRUPTED`, `REQUEST_INVALIDATED`, `RESULT_DISCARDED`, `RESULT_ACCEPTED`, `SPEAKING`).
* **Interactive Hackathon Demo Scenarios:** One-click controls to demonstrate:
  1. *Normal Conversational Turn* (low-latency conversational response)
  2. *Slow Tool Execution* (heavy computation with deliberate 8-second delay)
  3. *User Barge-in Interruption* (instantaneous cutoff, generation invalidation, stale-result fencing, and immediate Rime recovery playback)
* **Technology Badges:** Highlighting the integrated stack: **LiveKit Agents 1.8**, **Deepgram Nova-3**, **Gemma 4 31B**, and **Rime Coda TTS**.

---

## Installation & Running

### 1. Install Dependencies
From the repository root or inside the `frontend` directory:

```bash
# From repository root
pnpm install

# Or specifically inside frontend
cd frontend
pnpm install
```

### 2. Start Development Server
```bash
# From repository root
pnpm frontend:dev

# Or inside frontend
pnpm dev
```

The Vite development server will start at:
```
http://localhost:5173/
```

### 3. Build for Production
```bash
pnpm --filter @voiceflow/frontend build
```

---

## Architecture & LiveKit WebRTC Voice Integration

The frontend uses the official `livekit-client` SDK to connect directly to the LiveKit voice room:

1. **Authentication & Token Flow:**
   - On connection, the client requests a short-lived token from `/api/token?room=voiceflow-demo` (proxied by Vite to the backend token server at `http://localhost:3001/token`).
   - The token server loads LiveKit API keys from `.env` securely on the backend; **zero secrets or API keys are bundled or exposed in the frontend client**.
2. **Microphone Capture & Publishing:**
   - Calls `room.localParticipant.setMicrophoneEnabled(true)`, prompting standard browser microphone permissions.
   - Cleans up and surfaces permission errors (`NotAllowedError`, `NotFoundError`) clearly on screen.
   - Connects a Web Audio `AnalyserNode` to drive dynamic equalizer bar animations synchronized with your voice volume.
3. **Rime TTS Playback:**
   - Subscribes to the agent's incoming audio track via `RoomEvent.TrackSubscribed`.
   - Attaches the audio track to an HTML `<audio>` element with autoplay, ensuring low-latency streaming audio from Rime Coda (`luna` voice) plays through your speakers/headphones.
4. **Live Transcriptions & Barge-In:**
   - Listens to `RoomEvent.TranscriptionReceived` for Deepgram STT (user) and Rime TTS (agent) transcriptions.
   - Listens to `RoomEvent.ActiveSpeakersChanged` to detect real-time user barge-in over active agent speech, invalidating the current generation and updating the state machine immediately.
5. **Telemetry & Coordination:**
   - Shows live connection states (`Connecting`, `Live: voiceflow-demo`, `Disconnected`, `Connection Failed`).
   - Displays real WebRTC turns and coordinator states, while clearly demarcating live events from offline presentation triggers.

---

## End-to-End Voice Flow Running Guide

To run the complete live voice loop locally:

```bash
# Terminal 1: Start Token Server (Port 3001)
pnpm token:dev

# Terminal 2: Start VoiceFlow Agent Worker
pnpm agent:dev

# Terminal 3: Start Frontend Dashboard (Port 5173)
pnpm frontend:dev
```

Open `http://localhost:5173/` in your browser, click **"Connect Live"** or tap the microphone, allow microphone access, and speak directly with VoiceFlow!
