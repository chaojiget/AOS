import type { NextApiRequest, NextApiResponse } from "next";
import {
  buildBranchTree,
  readEpisodeEvents,
  readEpisodeIndexEntries,
  toLogFlowMessage,
} from "../../../lib/logflow";
import type {
  BranchOrigin,
  BranchResponse,
  EpisodeIndexEntry,
  LogFlowMessage,
} from "../../../types/logflow";

const METHOD = "GET";

function getQueryParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

function getRequestParam(req: NextApiRequest, key: string): string | undefined {
  const value = req.query[key];
  return getQueryParam(value as string | string[] | undefined);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== METHOD) {
    res.setHeader("Allow", METHOD);
    res.status(405).json({ error: "method_not_allowed", message: "Only GET is supported" });
    return;
  }

  const traceId = getRequestParam(req, "trace_id");
  if (!traceId) {
    res
      .status(400)
      .json({ error: "invalid_trace_id", message: "trace_id query parameter is required" });
    return;
  }

  const spanParam = getRequestParam(req, "span_id");
  const lnParam = getRequestParam(req, "ln") ?? getRequestParam(req, "origin_ln");

  let originLn: number | undefined;
  if (lnParam !== undefined) {
    const parsed = Number.parseInt(lnParam, 10);
    if (Number.isNaN(parsed)) {
      res.status(400).json({ error: "invalid_ln", message: "ln must be an integer" });
      return;
    }
    originLn = parsed;
  }

  try {
    const [events, indexEntries] = await Promise.all([
      readEpisodeEvents(traceId),
      readEpisodeIndexEntries(traceId),
    ]);
    const messages = events.map(toLogFlowMessage);

    let originSpanId = spanParam ?? undefined;
    if (!originSpanId && originLn !== undefined) {
      const entry = indexEntries.find((item: EpisodeIndexEntry) => item.ln === originLn);
      if (entry?.span_id) {
        originSpanId = entry.span_id;
      }
    }

    if (originSpanId && originLn === undefined) {
      const entry = indexEntries.find((item: EpisodeIndexEntry) => item.span_id === originSpanId);
      if (entry) {
        originLn = entry.ln;
      }
    }

    const origin: BranchOrigin = {};
    if (originSpanId) origin.span_id = originSpanId;
    if (originLn !== undefined) origin.ln = originLn;

    let branchMessages: LogFlowMessage[] = [];
    if (originSpanId) {
      branchMessages = messages.filter((msg: LogFlowMessage) => msg.span_id === originSpanId);
    } else if (originLn !== undefined) {
      const match = messages.find((msg: LogFlowMessage) => msg.ln === originLn);
      if (match) branchMessages = [match];
    }

    const tree = originSpanId ? buildBranchTree(messages, originSpanId) : null;

    if (!branchMessages.length && !tree) {
      res.status(404).json({ error: "branch_not_found", message: "No branch data for selection" });
      return;
    }

    const payload: BranchResponse = {
      trace_id: traceId,
      origin,
      messages: branchMessages,
      tree,
    };
    res.status(200).json(payload);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      res.status(404).json({ error: "episode_not_found", message: `episode ${traceId} not found` });
      return;
    }
    console.error("Failed to read logflow branch", err);
    res.status(500).json({ error: "internal_error", message: err?.message ?? "unexpected error" });
  }
}
