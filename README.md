# VoiceFlow

> **An interruption-safe realtime voice agent that fences stale tool results and delivers low-latency speech via Rime Coda on LiveKit Cloud Inference.**

Submitted for the **DataForge 2026 Rime Hackathon Challenge**.

---

## 1. Problem Statement

VoiceFlow is a production-ready realtime voice agent built with LiveKit Agents, LiveKit Cloud Inference (Deepgram Nova-3 STT, Google Gemma 4 31B LLM, and Rime Coda TTS), and a modern React dashboard. It solves conversational state corruption by cancelling in-flight computations and strictly fencing stale tool results when a user interrupts (barges in).

---

## 2. Why Voice Is Necessary

In graphical user interfaces or asynchronous text chats, users can easily ignore late-arriving messages, scroll past outdated cards, or wait out long background queries. Spoken audio, however, is strictly single-stream, sequential, and ephemeral:

* Users cannot "look past" spoken audio; an agent speaking an outdated answer causes immediate cognitive friction.
* If an agent completes a superseded task and speaks it after the user has already changed the topic, conversational coherence collapses.
* True conversational voice agents require instantaneous cutoff of active audio and mathematical guarantees that obsolete background tasks will never reach the text-to-speech engine.

---

## 3. The Core Hard-Voice Problem: Interruption During Long-Running Tool Execution

When an AI voice assistant executes an asynchronous, long-running tool (e.g. data analysis, report aggregation, complex lookups) that takes 3–10 seconds, users naturally interrupt mid-turn to redirect the conversation:

1. **User asks Request A:** The agent begins Request A and launches a long-running tool (`slow_analysis`).
2. **User interrupts with Request B:** The user speaks over the agent to ask an unrelated question.
3. **The Race Condition:** Without explicit fencing, Tool A finishes executing seconds later. Its output is returned into the chat history, prompting the LLM to summarize Tool A's results and send them to the TTS engine.
4. **The Failure:** The user hears the agent answer Request A *after* they asked Request B, producing audio desynchronization and phantom responses.

---

## 4. Key Innovation: Generation IDs, Cancellation, and Stale-Result Fencing

VoiceFlow introduces a lightweight, deterministic coordinator (`GenerationCoordinator`) paired with dual-signal cancellation:

* **Monotonic Generation IDs:** Every user turn recognized by STT or programmatic speech creation increments an active `generationId` (e.g., $101 \to 102 \to \dots$).
* **Dual-Signal Cancellation (`AbortSignal.any`):** The long-running tool observes both LiveKit's internal tool cancellation signal and VoiceFlow's generation-scoped abort signal. When barge-in occurs, the controller fires immediately, halting compute mid-flight (`ToolAbortError`).
* **Stale-Result Fencing (`fenceResult`):** Any tool result that attempts to resolve must pass through `coordinator.fenceResult(generationId, rawResult)`. If `generationId !== activeGenerationId` or if the generation was invalidated, the result is rejected (`RESULT_DISCARDED`) and never reaches the LLM context or Rime Coda TTS.

---

## 5. Architecture

```
                  ┌─────────────────────────────────┐
                  │       Browser Microphone        │
                  └────────────────┬────────────────┘
                                   │ Opus over WebRTC
                                   ▼
                  ┌─────────────────────────────────┐
                  │          LiveKit Cloud          │
                  │   wss://voiceflow-nxu49vnm...   │
                  └───────┬─────────────────▲───────┘
                          │                 │ WebRTC Audio Track
        WebRTC Audio In   │                 │ (24kHz PCM / Opus)
                          ▼                 │
                  ┌─────────────────────────┴───────┐
                  │      VoiceFlow Cloud Agent      │
                  │   Agent ID: CA_6YxEt5z5W5u9     │
                  │                                 │
                  │  ┌───────────────────────────┐  │
                  │  │   GenerationCoordinator   │  │
                  │  │  - Monotonic generationId │  │
                  │  │  - Dual-signal AbortAny   │  │
                  │  │  - Fencing: fenceResult() │  │
                  │  └─────────────┬─────────────┘  │
                  │                │                │
                  │  ┌─────────────▼─────────────┐  │
                  │  │    slow_analysis tool     │  │
                  │  │  (cancellable 5-10s delay)│  │
                  │  └───────────────────────────┘  │
                  └───────┬─────────────────▲───────┘
                          │                 │
             Streaming STT│                 │ Streaming TTS Audio
             (deepgram/   │                 │ (rime/coda, luna)
              nova-3)     ▼                 │
                  ┌─────────────────────────────────┐
                  │     LiveKit Cloud Inference     │
                  │                                 │
                  │  STT: deepgram/nova-3           │
                  │  LLM: google/gemma-4-31b-it     │
                  │  TTS: rime/coda (voice: luna)   │
                  └─────────────────────────────────┘
```

---

## 6. Technology Stack

* **Runtime:** Node.js 24+, TypeScript 5.9, pnpm
* **Transport & WebRTC:** LiveKit Agents JS (`@livekit/agents` 1.8.0), `@livekit/rtc-node` 0.13.34
* **Cloud Infrastructure:** LiveKit Cloud (Project: `voiceflow-nxu49vnm`, Agent: `voiceflow`, ID: `CA_6YxEt5z5W5u9`, Region: `us-east`)
* **Speech-to-Text (STT):** Deepgram Nova-3 (`deepgram/nova-3`) via LiveKit Cloud Inference
* **Large Language Model (LLM):** Google Gemma 4 31B (`google/gemma-4-31b-it`) via LiveKit Cloud Inference
* **Text-to-Speech (TTS):** Rime Coda (`rime/coda`, voice: `luna`, language: `en`) via LiveKit Cloud Inference
* **Frontend Web Application:** React 18, Vite 6, Tailwind/CSS glassmorphic UI, hosted on Vercel (`https://voiceflow-vert.vercel.app`)
* **Telemetry & Logging:** Structured JSON logging via Pino
* **Test Suite:** Vitest 4.1, Zod schema validation

---

## 7. How the Interruption/Recovery Flow Works

1. **User Speaks:** Deepgram Nova-3 STT finalizes speech via LiveKit Inference (`UserInputTranscribed`). The coordinator initializes `generationId: 101` (`GENERATION_STARTED`).
2. **Tool Launches:** The LLM calls `slow_analysis`. The coordinator transitions to `TOOL_RUNNING` and passes a combined `AbortSignal` to the operation.
3. **Barge-in Detected:** While the tool is running or agent speech is playing, the user begins speaking. LiveKit emits `OverlappingSpeech` (`isInterruption: true`) and `UserStateChanged` with `speaking`.
4. **Instantaneous Invalidation:**
   - Active LiveKit playout is immediately force-cut (`session.interrupt({ force: true })`).
   - The coordinator invalidates Generation 101 (`INTERRUPTED` and `REQUEST_INVALIDATED`).
   - The abort signal triggers, aborting the pending timer or computation with `ToolAbortError`.
5. **Fresh Turn Provisioning:** When the new speech finalizes, the coordinator registers `generationId: 102`.
6. **Fencing Execution:** If Tool 101 emits any late data, `fenceResult(101, ...)` evaluates `101 !== 102`, logs `RESULT_DISCARDED`, and discards the payload.
7. **Clean Playout:** Generation 102 completes its inference, is accepted (`RESULT_ACCEPTED`), and speaks the new response cleanly via Rime Coda (`SPEAKING`).

---

## 8. Rime TTS Integration Specification

VoiceFlow uses Rime's state-of-the-art **Coda** model through native LiveKit Cloud Inference for low-latency, expressive speech:

```typescript
const ttsModel = process.env.LIVEKIT_TTS_MODEL || 'rime/coda';
const ttsVoice = process.env.LIVEKIT_TTS_VOICE || 'luna';

const tts = new inference.TTS({
  model: ttsModel,
  voice: ttsVoice,
  language: 'en',
});
```

### Exact Audio & Protocol Details:
* **Model ID:** `rime/coda`
* **Speaker / Voice:** `luna`
* **Language:** `en` (English)
* **Inference Endpoint:** `https://agent-gateway.livekit.cloud/v1` (streaming WebSocket connection: `wss://agent-gateway.livekit.cloud/v1/tts?model=rime%2Fcoda`, authenticated via short-lived JWT inference bearer token)
* **Audio Format:** Linear PCM 16-bit little-endian (`pcm_s16le`), 16,000 Hz mono (1 channel), streamed from LiveKit Cloud Inference; encoded into WebRTC audio frames using standard Opus (48 kHz, adaptive bitrate) for playback in the browser.
* **Transport:** 
  - *Agent Worker ↔ Inference Gateway:* Persistent WebSocket stream (`wss://agent-gateway.livekit.cloud/v1/tts`) with connection pooling.
  - *Agent Worker ↔ Browser Client:* LiveKit Cloud SFU WebRTC peer connection (UDP/DTLS/SRTP).
* **Exclusive Spoken Output:** Rime Coda is the sole voice provider for all conversational responses and tool result summaries.

---

## 9. LiveKit Cloud Inference Pipeline

VoiceFlow leverages LiveKit Cloud's native AI Inference layer for unified, zero-overhead voice agent execution:

* **Speech-to-Text (STT):** `deepgram/nova-3` via `new inference.STT({ model: 'deepgram/nova-3' })`
* **Large Language Model (LLM):** `google/gemma-4-31b-it` via `new inference.LLM({ model: 'google/gemma-4-31b-it' })`
* **Text-to-Speech (TTS):** `rime/coda` (voice: `luna`) via `new inference.TTS({ model: 'rime/coda', voice: 'luna', language: 'en' })`
* **Turn Detection:** `new inference.TurnDetector()` with adaptive endpointing (`minDelay: 300ms`, `maxDelay: 2000ms`) and barge-in detection (`mode: 'adaptive'`).
* **Zero Direct Provider Key Management:** By routing STT, LLM, and TTS through LiveKit Cloud Inference, individual provider API keys (such as `RIME_API_KEY` or `DEEPGRAM_API_KEY`) do not need to be distributed or managed on individual agent worker nodes.

---

## 10. Third-Party Services

| Service | Role | Configuration / Model |
| :--- | :--- | :--- |
| **LiveKit Cloud** | Realtime WebRTC transport, SFU, and hosted container orchestration | Project: `voiceflow-nxu49vnm`, Region: `us-east` |
| **LiveKit Cloud Inference** | Unified model inference gateway & provider routing | Managed serverless inference |
| **Rime AI** | High-fidelity neural voice synthesis | Model: `rime/coda`, Voice: `luna` |
| **Deepgram** | Fast streaming speech recognition | Model: `deepgram/nova-3` |
| **Google DeepMind** | Conversational reasoning and tool orchestration | Model: `google/gemma-4-31b-it` |
| **Vercel** | Edge frontend hosting & serverless token minting (`/api/token`) | Project: `voiceflow`, `https://voiceflow-vert.vercel.app` |

---

## 11. Known Limitations

* **Single-Participant Session Scope:** Generation tracking and barge-in invalidation are scoped to the primary interactive participant in a room session. Multi-user cross-talk in conference rooms requires per-participant generation state tracking.
* **Irreversible External Side-Effects:** The cancellable tool implementation safely aborts in-memory async delays, computations, and read queries via `AbortSignal`. Remote network operations with non-idempotent side effects (e.g. database mutations or financial transactions) require application-specific compensation or rollback handlers upon receiving `signal.aborted`.

---

## 12. Failure Behavior & Resilience

* **Superseded Tool Discard:** When an in-flight tool finishes after a barge-in, `coordinator.fenceResult()` evaluates `generationId !== activeGenerationId` and drops the result (`RESULT_DISCARDED`). It is never passed to the LLM or TTS, preventing phantom audio and chat history corruption.
* **Abort Handling Without Worker Crash:** Aborting operations with `ToolAbortError` is handled cleanly within the tool wrapper; the worker remains healthy and ready for subsequent turns.
* **Provider & Stream Error Propagation:** `tts.on('error')` and `session.on('error')` intercept transient upstream provider failures, logging structured diagnostics without tearing down the underlying WebRTC session.
* **Participant Cleanup:** Disconnection of the user immediately closes the session (`closeOnDisconnect: true`), preventing orphan worker compute.

---

## 13. Setup & Reproduction Guide

### Prerequisites
* Node.js 24+ and npm (or pnpm)
* LiveKit Cloud account with an active project

### Local Setup
1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env and supply your LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET
   ```
3. Verify typecheck and unit tests:
   ```bash
   # Backend typecheck & tests
   cd backend
   npm run typecheck
   npm test

   # Frontend build & typecheck
   cd ../frontend
   npm run build
   ```
4. Start the agent worker locally (or deploy to LiveKit Cloud):
   ```bash
   cd backend
   npm run dev
   ```

### Production Access
The production system is deployed and live:
* **Frontend Web Application:** `https://voiceflow-vert.vercel.app`
* **LiveKit Cloud Project:** `voiceflow-nxu49vnm` (`us-east`)
* **LiveKit Cloud Agent:** `voiceflow` (`CA_6YxEt5z5W5u9`)

---

## 14. Acceptance Test Summary

| Requirement | Behavior | Status |
| :--- | :--- | :--- |
| **Deliberate Slow Tool** | `slow_analysis` runs with configurable 5–10s delay | Passed |
| **Barge-In Playout Cutoff** | `session.interrupt({ force: true })` halts active audio immediately | Passed |
| **Active Generation Invalidation** | Controller fires abort signal; state transitions to `INTERRUPTED` | Passed |
| **Stale Result Fencing** | `fenceResult` discards any late-arriving result | Passed (`RESULT_DISCARDED`) |
| **New Turn Recovery** | New generation ID created on follow-up user turn | Passed (`RESULT_ACCEPTED`) |
| **Rime Speech Output** | Rime Coda (`luna`) speaks only the newly accepted response | Passed (`SPEAKING`) |

---

## 15. Evidence & Reproducibility

Detailed runtime evidence, log snippets, and test execution traces are documented in [`RIME_EVIDENCE.md`](./RIME_EVIDENCE.md).

Key observed log markers from test execution:
* **Generation Invalidation:** `state: "INTERRUPTED"`, `state: "REQUEST_INVALIDATED"`
* **Stale Discard:** `state: "RESULT_DISCARDED"`, `reason: "stale_generation"`
* **Generation Acceptance:** `state: "RESULT_ACCEPTED"`, `state: "SPEAKING"`
* **Rime Synthesis Traces:** `[TTS START] LIVEKIT INFERENCE TTS STREAM`, `[TTS COMPLETION]`
* **Unit & Integration Suite:** 8 of 8 tests passing across coordinator fencing, rapid sequential interruptions, and `AbortSignal.any` integration.

---

## 16. Project Structure

```
VOICEFLOW/
├── README.md               # Project documentation and hackathon submission overview
├── RIME_EVIDENCE.md        # Technical evidence and acceptance test log report
├── .env.example            # Environment variable template with placeholders
├── backend/
│   ├── package.json        # Backend package definition and scripts
│   ├── livekit.toml        # LiveKit Cloud agent deployment configuration
│   ├── Dockerfile          # Container build definition for LiveKit Cloud
│   ├── tsconfig.json       # Backend TypeScript configuration
│   ├── vitest.config.ts    # Vitest testing configuration
│   ├── src/
│   │   ├── agent.ts        # LiveKit agent definition, LiveKit Inference & barge-in logic
│   │   ├── coordinator.ts  # GenerationCoordinator: generation IDs, fencing & state machine
│   │   ├── slow-tool.ts    # Cancellable slow_analysis FunctionTool & Zod schemas
│   │   ├── prompts.ts      # VoiceFlow voice-first system instructions
│   │   ├── logger.ts       # Structured Pino logger
│   │   ├── config.ts       # Environment variable validation
│   │   └── token-server.ts # Optional local token minting server
│   └── test/
│       ├── config.test.ts      # Environment validation test suite
│       └── coordinator.test.ts # Coordinator, fencing, and cancellation test suite
└── frontend/
    ├── package.json        # Frontend package definition
    ├── vite.config.ts      # Vite configuration
    ├── api/
    │   └── token.ts        # Vercel serverless participant token handler
    └── src/
        ├── App.tsx         # Root application component
        ├── useLiveKitVoice.ts # LiveKit client connection hook
        └── components/     # Header, VoiceVisualizer, GenerationCard, EventLog
```
