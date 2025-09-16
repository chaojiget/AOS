import type { NextApiRequest, NextApiResponse } from "next";
import {
  readEpisodeEvents,
  readEpisodeIndexEntries,
  toLogFlowMessage,
} from "../../../lib/logflow";
import type { MainlineResponse } from "../../../types/logflow";

const METHOD = "GET";

function getQueryParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  if (req.method !== METHOD) {
    res.setHeader("Allow", METHOD);
    res.status(405).json({ error: "method_not_allowed", message: "Only GET is supported" });
    return;
  }

  const traceId = getQueryParam(req.query.trace_id);
  if (!traceId) {
    res
      .status(400)
      .json({ error: "invalid_trace_id", message: "trace_id query parameter is required" });
    return;
  }

  try {
    const [events, indexEntries] = await Promise.all([
      readEpisodeEvents(traceId),
      readEpisodeIndexEntries(traceId),
    ]);
    const messages = events.map(toLogFlowMessage);
    const payload: MainlineResponse = {
      trace_id: traceId,
      messages,
      index: indexEntries,
    };
    res.status(200).json(payload);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      res
        .status(404)
        .json({ error: "episode_not_found", message: `episode ${traceId} not found` });
      return;
    }
    console.error("Failed to read mainline logflow", err);
    res
      .status(500)
      .json({ error: "internal_error", message: err?.message ?? "unexpected error" });
  }
}
