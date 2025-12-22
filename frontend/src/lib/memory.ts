export type MemoryItem = {
  id: number;
  created_at: string;
  source_trace_id: string | null;
  title: string;
  content: string;
  tags: string;
  embedding_id: string | null;
};
