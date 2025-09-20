import type { NextApiRequest, NextApiResponse } from "next";

import { getGuardianBudgetDto, listGuardianAlerts, subscribeGuardianEvents } from "../state";

export const config = {
  api: {
    bodyParser: false,
  },
};

function sendEvent(res: NextApiResponse, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export default function handler(req: NextApiRequest, res: NextApiResponse): void {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: { message: "Method Not Allowed" } });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.writeHead(200);
  res.flushHeaders?.();

  const unsubscribe = subscribeGuardianEvents((event) => {
    sendEvent(res, event);
  });

  sendEvent(res, { type: "budget.updated", budget: getGuardianBudgetDto() });
  for (const alert of listGuardianAlerts()) {
    sendEvent(res, {
      type: alert.status === "resolved" ? "alert.resolved" : "alert.updated",
      alert: {
        id: alert.id,
        message: alert.message,
        severity: alert.severity,
        status: alert.status,
        require_approval: alert.requireApproval,
        created_at: alert.createdAt,
        updated_at: alert.updatedAt,
        trace_id: alert.traceId,
        replay_url: alert.replayUrl,
        details_url: alert.detailsUrl,
      },
    });
  }

  const closeConnection = () => {
    unsubscribe();
    res.end();
  };

  req.on("close", closeConnection);
  req.on("error", closeConnection);
}
