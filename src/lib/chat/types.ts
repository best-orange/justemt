export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface UserPersona {
  name?: string;
  description?: string;
  notes?: string[];
}

export interface ChatState {
  relationshipStage: 'stranger' | 'acquaintance' | 'trusted' | 'close';
  trust: number;
  affinity: number;
  mood: string;
  location?: string;
  scene?: string;
  turnCount: number;
}

export interface ChatMemory {
  summary: string;
  facts: string[];
  importantEvents: string[];
}

export interface ChatContext {
  persona?: UserPersona;
  state: ChatState;
  memory: ChatMemory;
}

export interface CharacterProfile {
  id: string;
  name: string;
  identity: string[];
  personality: string[];
  speakingStyle: string[];
  behaviorRules: string[];
  scenario: string[];
  worldNotes: string[];
}

export interface ProviderMessage {
  role: 'system' | ChatRole;
  content: string;
}
