export type AgentState =
  | 'LISTENING'
  | 'THINKING'
  | 'PROCESSING_TOOL'
  | 'SPEAKING'
  | 'INTERRUPTED';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export type EventSource = 'backend' | 'livekit' | 'simulation';

export interface CoordinatorEvent {
  id: string;
  timestamp: number;
  state:
    | 'GENERATION_STARTED'
    | 'TOOL_RUNNING'
    | 'INTERRUPTED'
    | 'REQUEST_INVALIDATED'
    | 'RESULT_DISCARDED'
    | 'RESULT_ACCEPTED'
    | 'SPEAKING'
    | 'LISTENING'
    | 'CONNECTED'
    | 'DISCONNECTED';
  generationId: number;
  reason?: string;
  metadata?: Record<string, unknown>;
  details?: string;
  source?: EventSource;
}

export interface GenerationInfo {
  id: number;
  status: 'active' | 'completed' | 'interrupted' | 'fenced';
  query: string;
  startedAt: number;
  endedAt?: number;
  toolRunning?: boolean;
  toolQuery?: string;
  resultSummary?: string;
  discardReason?: string;
  source?: EventSource;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  generationId: number;
  timestamp: number;
  interrupted?: boolean;
}
