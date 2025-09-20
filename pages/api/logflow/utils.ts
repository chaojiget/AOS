import { readEpisodeEvents, readEpisodeIndexEntries } from "../../../lib/logflow";
import { toLogFlowMessage } from "../../../lib/logflowMessages";
import type { EpisodeIndexEntry, LogFlowMessage } from "../../../types/logflow";
import type { EventEnvelope } from "../../../runtime/events";

export interface LoadLogFlowResult {
  messages: LogFlowMessage[];
  index: EpisodeIndexEntry[];
}

function sortByLineNumber(messages: LogFlowMessage[]): LogFlowMessage[] {
  return [...messages].sort((a, b) => a.ln - b.ln);
}

export async function loadLogFlow(traceId: string): Promise<LoadLogFlowResult> {
  const events = await readEpisodeEvents(traceId);
  const messages = sortByLineNumber(events.map((event: EventEnvelope) => toLogFlowMessage(event)));
  const index = await readEpisodeIndexEntries(traceId);
  return { messages, index };
}
