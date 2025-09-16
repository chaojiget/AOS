export interface EpisodeIndexEntry {
  ln: number;
  span_id?: string;
  byte_offset: number;
}

export interface LogFlowMessage {
  id: string;
  ln: number;
  span_id?: string;
  parent_span_id?: string;
  type: string;
  ts: string;
  level?: "debug" | "info" | "warn" | "error";
  message: string;
  data: unknown;
  byte_offset?: number;
}

export interface BranchNode {
  span_id: string;
  parent_span_id?: string;
  first_ln: number;
  last_ln: number;
  events: LogFlowMessage[];
  children: BranchNode[];
}

export interface BranchOrigin {
  span_id?: string;
  ln?: number;
}

export interface MainlineResponse {
  trace_id: string;
  messages: LogFlowMessage[];
  index: EpisodeIndexEntry[];
}

export interface BranchResponse {
  trace_id: string;
  origin: BranchOrigin;
  messages: LogFlowMessage[];
  tree: BranchNode | null;
}
