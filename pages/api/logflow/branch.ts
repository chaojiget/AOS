import type { NextApiRequest, NextApiResponse } from "next";

import { buildBranchTree } from "../../../lib/logflow";
import type { BranchNode, BranchResponse, LogFlowMessage } from "../../../types/logflow";
import { loadLogFlow } from "./utils";

function parseTraceId(query: NextApiRequest["query"]): string | null {
  const raw = query.trace_id ?? query.traceId ?? query.id;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseSpanId(query: NextApiRequest["query"]): string | null {
  const raw = query.span_id ?? query.spanId ?? null;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseMessageId(query: NextApiRequest["query"]): string | null {
  const raw = query.message_id ?? query.messageId ?? null;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function collectMessagesFromTree(node: BranchNode | null): LogFlowMessage[] {
  if (!node) {
    return [];
  }
  const stack: BranchNode[] = [node];
  const collected: LogFlowMessage[] = [];
  while (stack.length) {
    const current = stack.pop()!;
    collected.push(...current.events);
    for (const child of current.children) {
      stack.push(child);
    }
  }
  return collected.sort((a, b) => a.ln - b.ln);
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

  const explicitSpanId = parseSpanId(req.query);
  const messageId = parseMessageId(req.query);

  try {
    const { messages } = await loadLogFlow(traceId);
    if (!messages.length) {
      const payload: BranchResponse = {
        trace_id: traceId,
        origin: { span_id: explicitSpanId ?? undefined, ln: undefined },
        messages: [],
        tree: null,
      };
      res.status(200).json(payload);
      return;
    }

    let resolvedSpanId = explicitSpanId;
    let originLine: number | undefined;

    if (messageId) {
      const matched = messages.find((msg) => msg.id === messageId);
      if (!matched) {
        res
          .status(404)
          .json({ error: { message: `message ${messageId} not found in trace ${traceId}` } });
        return;
      }
      resolvedSpanId = resolvedSpanId ?? matched.span_id ?? null;
      originLine = matched.ln;
    }

    if (!resolvedSpanId) {
      res.status(400).json({ error: { message: "span_id is required" } });
      return;
    }

    const tree = buildBranchTree(messages, resolvedSpanId) ?? null;
    const branchMessages = tree
      ? collectMessagesFromTree(tree)
      : messages.filter((msg) => msg.span_id === resolvedSpanId).sort((a, b) => a.ln - b.ln);

    if (branchMessages.length === 0) {
      res
        .status(404)
        .json({ error: { message: `span ${resolvedSpanId} not found in trace ${traceId}` } });
      return;
    }

    if (originLine === undefined) {
      originLine = branchMessages[0]?.ln;
    }

    const payload: BranchResponse = {
      trace_id: traceId,
      origin: {
        span_id: resolvedSpanId,
        ln: originLine,
      },
      messages: branchMessages,
      tree,
    };

    res.status(200).json(payload);
  } catch (error: any) {
    if (error?.code === "ENOENT" || /not found/i.test(error?.message ?? "")) {
      res.status(404).json({ error: { message: `trace ${traceId} not found` } });
      return;
    }
    const message = error?.message ?? "failed to load logflow branch";
    res.status(500).json({ error: { message } });
  }
}
