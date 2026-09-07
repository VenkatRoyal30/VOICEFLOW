# VoiceFlow

> **An interruption-safe realtime voice agent that fences stale tool results and delivers low-latency speech via Rime TTS.**

Submitted for the **DataForge 2026 Rime Hackathon Challenge**.

---

## 1. Problem Statement

VoiceFlow is a realtime voice agent built with LiveKit, Deepgram STT, local Ollama LLM, and Rime TTS that solves conversational state corruption by cancelling in-flight computation and strictly fencing stale tool results when a user interrupts (barges in).

---

## 2. Why Voice Is Necessary

In graphical user interfaces or asynchronous text chats, users can easily ignore late-arriving messages, scroll past outdated cards, or wait out long background queries. Spoken audio, however, is strictly single-stream, sequential, and ephemeral:

* Users cannot "look past" spoken audio; an agent speaking an outdated answer causes immediate cognitive friction.
* If an agent completes a superseded task and speaks it after the user has already changed the topic, conversational coherence collapses.
* True conversational voice agents require instantaneous cutoff of active audio and mathematical guarantees that obsolete background tasks will never reach the text-to-speech engine.

---

## 3. The Core Hard-Voice Problem: Interruption During Long-Running Tool Execution

When an AI voice assistant executes an asynchronous, long-running tool (e.g. data analysis, report aggregation, complex lookups) that takes 3–10 seconds, users naturally interrupt mid-turn to redirect the conversation:

1. **User asks Request A:** The agent begins Request A and launches a long-running tool.
2. **User interrupts with Request B:** The user speaks over the agent to ask an unrelated question.
3. **The Race Condition:** Without explicit fencing, Tool A finishes executing seconds later. Its output is returned into the chat history, prompting the LLM to summarize Tool A's results and send them to the TTS engine.
4. **The Failure:** The user hears the agent answer Request A *after* they asked Request B, producing audio desynchronization and phantom responses.

---

## 4. Key Innovation: Generation IDs, Cancellation, and Stale-Result Fencing

VoiceFlow introduces a lightweight, deterministic coordinator (`GenerationCoordinator`) paired with dual-signal cancellation:

* **Monotonic Generation IDs:** Every user turn recognized by Deepgram STT or programmatic speech creation increments an active `generationId` (e.g., $101 \to 102 \to \dots$).
* **Dual-Signal Cancellation (`AbortSignal.any`):** The long-running tool observes both LiveKit's internal tool cancellation signal and VoiceFlow's generation-scoped abort signal. When barge-in occurs, the controller fires immediately, halting compute mid-flight (`ToolAbortError`).
* **Stale-Result Fencing (`fenceResult`):** Any tool result that attempts to resolve must pass through `coordinator.fenceResult(generationId, rawResult)`. If `generationId !== activeGenerationId` or if the generation was invalidated, the result is rejected (`RESULT_DISCARDED`) and never reaches the LLM context or Rime TTS.

---

## 5. Architecture

```
                  ┌─────────────────────────────────┐
                  │          User Audio             │
                  └────────────────┬────────────────┘
                                   │
                                   ▼
                  ┌─────────────────────────────────┐
                  │       Deepgram STT (nova-3)     │
                  └────────────────┬────────────────┘
                                   │ UserInputTranscribed
                                   ▼
                  ┌─────────────────────────────────┐
                  │      GenerationCoordinator      │
                  │  - Increments generationId      │
                  │  - Issues AbortController       │
                  │  - Fences late-arriving results │
                  └──────┬───────────────────▲──────┘
                         │                   │
               Execute   │                   │ Validate / Fence
               Tool      ▼                   │ (RESULT_ACCEPTED or
                  ┌──────────────┐           │  RESULT_DISCARDED)
                  │  slow_tool   ├───────────┘
                  └──────┬───────┘
                         │
                         ▼
                  ┌─────────────────────────────────┐
                  │     Local Ollama (llama3.2)     │
                  │      Chat Completions API       │
                  └────────────────┬────────────────┘
                                   │ Incremental text stream
                                   ▼
                  ┌─────────────────────────────────┐
                  │         Rime Coda TTS           │
                  │   WebSocket stream (ws3)        │
                  │   segment: 'immediate'          │
                  └────────────────┬────────────────┘
                                   │
                                   ▼
                  ┌─────────────────────────────────┐
                  │   LiveKit Audio Output Track    │
                  └─────────────────────────────────┘
```

---

## 6. Technology Stack

* **Runtime:** Node.js 24+, TypeScript 5.9, pnpm
* **Orchestration & WebRTC:** LiveKit Agents JS (`@livekit/agents` 1.8.0), `@livekit/rtc-node` 0.13.34
* **Speech-to-Text (STT):** Deepgram Nova-3 (`@livekit/agents-plugin-deepgram` 1.8.0)
* **Large Language Model (LLM):** Local Ollama (`llama3.2:latest`) via `@livekit/agents-plugin-openai` 1.8.0 pointed to `http://localhost:11434/v1`
* **Text-to-Speech (TTS):** Rime AI (`@livekit/agents-plugin-rime` 1.8.0), `coda` model, `celeste` speaker
* **Telemetry & Logging:** Structured JSON logging via Pino
* **Test Suite:** Vitest 4.1, Zod schema validation

---

## 7. How the Interruption/Recovery Flow Works

1. **User Speaks:** Deepgram STT finalizes speech (`UserInputTranscribed`). The coordinator initializes `generationId: 101` (`GENERATION_STARTED`).
2. **Tool Launches:** The LLM calls `slow_analysis`. The coordinator transitions to `TOOL_RUNNING` and passes a combined `AbortSignal` to the operation.
3. **Barge-in Detected:** While the tool is running or agent speech is playing, the user begins speaking. LiveKit emits `UserStateChanged` with `speaking`.
4. **Instantaneous Invalidation:**
   - Active LiveKit playout is immediately force-cut (`session.interrupt({ force: true })`).
   - The coordinator invalidates Generation 101 (`INTERRUPTED` and `REQUEST_INVALIDATED`).
   - The abort signal triggers, aborting the pending timer or task with `ToolAbortError`.
5. **Fresh Turn Provisioning:** When the new speech finalizes, the coordinator registers `generationId: 102`.
6. **Fencing Execution:** If Tool 101 emits any late data, `fenceResult(101, ...)` evaluates `101 !== 102`, logs `RESULT_DISCARDED`, and discards the payload.
7. **Clean Playout:** Generation 102 completes its inference, is accepted (`RESULT_ACCEPTED`), and speaks the new response cleanly via Rime TTS (`SPEAKING`).

---

## 8. Rime TTS Integration

VoiceFlow integrates the official `@livekit/agents-plugin-rime` 1.8.0 provider with low-latency streaming options:

```typescript
tts: new rime.TTS({
  modelId: 'coda',
  speaker: 'celeste',
  useWebsocket: true,
  segment: 'immediate',
})
```

* **WebSocket API (`ws3`):** Audio chunks stream over persistent WebSockets (`wss://users-ws.rime.ai/ws3`), eliminating HTTP handshake overhead.
* **Immediate Segmentation (`segment: 'immediate'`):** Bypasses server-side sentence buffering and artificial padding, preventing audio playback buffer starvation and delivering smooth conversational cadence.
* **Exclusive Output:** Rime is the only configured TTS provider across the entire agent lifecycle.

---

## 9. Local Ollama LLM Setup

To eliminate paid API token dependencies and demonstrate high-throughput local inference, VoiceFlow uses a local Ollama instance:

* **Model:** Meta Llama 3.2 (`llama3.2:latest`, 3B parameters)
* **Integration:** Connected via the OpenAI-compatible HTTP interface provided by `@livekit/agents-plugin-openai`:
  ```typescript
  llm: openai.LLM.withOllama({
    model: 'llama3.2',
    baseURL: 'http://localhost:11434/v1',
  })
  ```
* **Connection Timeout:** Configured with `llmConnOptions: { timeoutMs: 30000 }` to accommodate local model loading.
* **Zero Cloud LLM Costs:** Local inference runs entirely on the host machine; only STT (Deepgram) and TTS (Rime) use cloud API endpoints.

---

## 10. Reproduction / Demo Instructions

### Prerequisites
* Node.js 24+ and pnpm installed
* Ollama installed and running locally with Llama 3.2:
  ```bash
  ollama run llama3.2
  ```
* A LiveKit Cloud project or local server
* Valid `RIME_API_KEY` and `DEEPGRAM_API_KEY`

### Setup
1. Clone the repository and install dependencies:
   ```bash
   pnpm install
   ```
2. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env and supply your LIVEKIT_*, RIME_API_KEY, and DEEPGRAM_API_KEY
   ```
3. Verify typecheck and unit tests:
   ```bash
   pnpm typecheck
   pnpm test
   ```
4. Start the voice worker:
   ```bash
   pnpm agent:dev
   ```
5. Open the **LiveKit Agent Playground** or **LiveKit Console**, connect to the room, and enable your microphone.

### Acceptance Test Procedure
1. **Trigger Long-Running Task:** Say clearly:  
   *"Run a slow analysis on customer churn with an 8 second delay."*  
   *Log verification:* `generationId: <N>` begins and transitions to `TOOL_RUNNING`.
2. **Interrupt Mid-Turn:** After 2–3 seconds while the task is executing, interrupt and speak:  
   *"Stop that, tell me a quick joke instead."*
3. **Verify Behavior:**
   * Audio stops immediately upon voice onset.
   * Console logs show Generation $N$ is `INTERRUPTED` and `REQUEST_INVALIDATED`.
   * Stale results from Generation $N$ are logged as `RESULT_DISCARDED`.
   * Generation $N+1$ produces the joke. Rime TTS speaks the joke cleanly with zero mention of customer churn.

---

## 11. Acceptance-Test Summary

| Requirement | Behavior | Status |
| :--- | :--- | :--- |
| **Deliberate Slow Tool** | Runs with configurable 5–10s delay | Passed |
| **Barge-In Playout Cutoff** | `session.interrupt({ force: true })` halts active audio | Passed |
| **Active Generation Invalidation** | Controller fires abort signal; state transitions to `INTERRUPTED` | Passed |
| **Stale Result Fencing** | `fenceResult` discards any late-arriving result | Passed (`RESULT_DISCARDED`) |
| **New Turn Recovery** | New generation ID created on follow-up user turn | Passed (`RESULT_ACCEPTED`) |
| **Rime Speech Output** | Rime Coda speaks only the newly accepted response | Passed (`SPEAKING`) |

---

## 12. Evidence & Reproducibility

Detailed runtime evidence, log snippets, and test execution traces are documented in [`RIME_EVIDENCE.md`](./RIME_EVIDENCE.md).

Key observed log markers from test execution:
* **Generation 107 Invalidation:** `state: "INTERRUPTED"`, `state: "REQUEST_INVALIDATED"`
* **Stale Discard:** `state: "RESULT_DISCARDED"`, `reason: "stale_generation"`
* **Generation 108 Acceptance:** `state: "RESULT_ACCEPTED"`, `state: "SPEAKING"`
* **Unit & Integration Suite:** 8 of 8 tests passing across coordinator fencing, rapid sequential interruptions, and `AbortSignal.any` integration.

---

## 13. Limitations

* **Single-Participant Focus:** Generation tracking is currently scoped to a primary interactive participant per session. Supporting multi-user cross-talk in conference rooms requires per-participant generation state.
* **External Side-Effects:** The coordinator aborts in-memory tasks, async delays, and read computations. Remote network calls with non-idempotent side effects (e.g. database writes) require separate compensation logic upon receiving `signal.aborted`.
* **Local LLM Tool Arguments:** Smaller local models (such as Llama 3.2 3B) sometimes output numeric arguments as strings (e.g. `"5000"` or `"5000ms"`). VoiceFlow uses Zod preprocessing to normalize numeric strings into numbers while maintaining strict numeric validation.

---

## 14. Project Structure

```
DataForge2026_VoiceFlow/
├── README.md               # Project documentation and hackathon submission overview
├── RIME_EVIDENCE.md        # Technical evidence and acceptance test log report
├── package.json            # Root workspace configuration
├── pnpm-workspace.yaml     # Workspace declaration
├── tsconfig.base.json      # Base TypeScript compiler configuration
├── .env.example            # Environment variable template
└── backend/
    ├── package.json        # Backend package definition and scripts
    ├── tsconfig.json       # Backend TypeScript configuration
    ├── vitest.config.ts    # Vitest testing configuration
    ├── src/
    │   ├── agent.ts        # LiveKit agent definition, lifecycle hooks & barge-in logic
    │   ├── coordinator.ts  # GenerationCoordinator: generation IDs, fencing & state machine
    │   ├── slow-tool.ts    # Cancellable slow_analysis FunctionTool & Zod schemas
    │   ├── logger.ts       # Structured Pino logger
    │   ├── config.ts       # Environment variable validation
    │   └── token-server.ts # Optional token minting server
    └── test/
        ├── config.test.ts      # Environment validation test suite
        └── coordinator.test.ts # Coordinator, fencing, and cancellation test suite
```

---

## 15. Environment Variables (`.env.example`)

VoiceFlow reads configuration from environment variables defined in `.env`:

```env
# LiveKit server credentials (server-side only)
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=replace_me
LIVEKIT_API_SECRET=replace_me

# AI provider credentials (server-side only)
RIME_API_KEY=replace_me
DEEPGRAM_API_KEY=replace_me
# OPENAI_API_KEY is optional when using local Ollama
OPENAI_API_KEY=ollama

# Optional local token server
TOKEN_SERVER_PORT=3001
```

> **Security Note:** All credentials and secrets remain strictly on the server. Never commit `.env` to version control.
