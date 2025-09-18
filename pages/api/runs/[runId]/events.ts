import type { NextApiRequest, NextApiResponse } from "next";

import {
  resolveApiBaseUrl,
  buildAuthHeaders,
  fetchRemoteRunEvents,
  getLocalRunEvents,
  serialiseEvents,
} from "../../run";

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
  const since = typeof req.query.since === "string" ? req.query.since : undefined;

  try {
    if (apiBase) {
      const eventsResponse = await fetchRemoteRunEvents(apiBase, runId, headers, since);
      if (eventsResponse) {
        res.status(200).json(eventsResponse);
        return;
      }
    }

    const sinceNumber = since ? Date.parse(since) : undefined;
    const events = await getLocalRunEvents(
      runId,
      Number.isFinite(sinceNumber) ? sinceNumber : undefined,
    );
    res.status(200).json({ events: serialiseEvents(events) });
  } catch (error: any) {
    if (error?.status === 404 || /not found/i.test(error?.message ?? "")) {
      res.status(404).json({ error: { message: `run ${runId} not found` } });
      return;
    }
    const message = error?.message ?? "failed to fetch run events";
    res.status(500).json({ error: { message } });
  }
}
