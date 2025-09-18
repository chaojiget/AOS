import type { NextApiRequest, NextApiResponse } from "next";

import { resolveApiBaseUrl, buildAuthHeaders, getLocalRunStream } from "../../run";

function toSseData(event: {
  id: string;
  ts: string;
  type: string;
  data: unknown;
  spanId?: string | null;
  parentSpanId?: string | null;
  topic?: string | null;
  level?: string | null;
  version?: number | null;
}) {
  return {
    id: event.id,
    ts: event.ts,
    type: event.type,
    data: event.data,
    span_id: event.spanId ?? null,
    parent_span_id: event.parentSpanId ?? null,
    topic: event.topic ?? null,
    level: event.level ?? null,
    version: event.version ?? null,
  };
}

function writeSse(res: NextApiResponse, event: { type: string; data: any }) {
  const payload = JSON.stringify(event.data ?? {});
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${payload}\n\n`);
}

async function proxyRemoteStream(
  apiBase: string,
  runId: string,
  headers: Record<string, string>,
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  const controller = new AbortController();
  const response = await fetch(`${apiBase}/runs/${encodeURIComponent(runId)}/stream`, {
    headers,
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    res.status(response.status).end();
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  const reader = response.body.getReader();

  const close = async () => {
    try {
      controller.abort();
      await reader.cancel();
    } catch {
      /* ignore */
    }
    res.end();
  };

  req.socket.on("close", close);

  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      res.write(Buffer.from(value));
    }
  }

  req.socket.off("close", close);
  res.end();
}

async function handleLocalStream(
  runId: string,
  res: NextApiResponse,
  req: NextApiRequest,
): Promise<void> {
  const { events, stream } = await getLocalRunStream(runId);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  for (const event of events) {
    writeSse(res, {
      type: event.type,
      data: toSseData({
        id: event.id,
        ts: event.ts,
        type: event.type,
        data: event.data,
        spanId: event.spanId,
        parentSpanId: event.parentSpanId,
        topic: event.topic,
        level: event.level,
        version: event.version,
      }),
    });
  }

  const subscription = stream.subscribe((event) => {
    writeSse(res, { type: event.type, data: event.data });
  });

  const close = () => {
    subscription.unsubscribe();
    res.end();
  };

  req.socket.on("close", close);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const { runId } = req.query;

  if (typeof runId !== "string" || !runId) {
    res.status(400).json({ error: { message: "runId is required" } });
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: { message: "Method Not Allowed" } });
    return;
  }

  const apiBase = resolveApiBaseUrl();
  const headers = buildAuthHeaders();

  try {
    if (apiBase) {
      await proxyRemoteStream(apiBase, runId, headers, req, res);
      return;
    }

    await handleLocalStream(runId, res, req);
  } catch (error: any) {
    const message = error?.message ?? "failed to stream run events";
    res.status(500).json({ error: { message } });
  }
}
