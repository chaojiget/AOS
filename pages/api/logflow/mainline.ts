import type { NextApiRequest, NextApiResponse } from "next";

import type { MainlineResponse } from "../../../types/logflow";
import { loadLogFlow } from "./utils";

function parseTraceId(query: NextApiRequest["query"]): string | null {
  const raw = query.trace_id ?? query.traceId ?? query.id;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: { message: "Method Not Allowed" } });
    return;
  }

  const traceId = parseTraceId(req.query);
  if (!traceId) {
    res.status(400).json({ error: { message: "trace_id is required" } });
    return;
  }

  try {
    const { messages, index } = await loadLogFlow(traceId);
    const payload: MainlineResponse = {
      trace_id: traceId,
      messages,
      index,
    };
    res.status(200).json(payload);
  } catch (error: any) {
    if (error?.code === "ENOENT" || /not found/i.test(error?.message ?? "")) {
      res.status(404).json({ error: { message: `trace ${traceId} not found` } });
      return;
    }
    const message = error?.message ?? "failed to load logflow mainline";
    res.status(500).json({ error: { message } });
  }
}
