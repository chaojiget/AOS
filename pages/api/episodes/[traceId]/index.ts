import type { NextApiRequest, NextApiResponse } from "next";

import { fetchRemoteEpisodeDetail, getEpisodeLocally } from "../utils";

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: { message: "Method Not Allowed" } });
    return;
  }

  const { traceId } = req.query;
  if (typeof traceId !== "string" || traceId.trim() === "") {
    res.status(400).json({ error: { message: "traceId is required" } });
    return;
  }

  try {
    const remote = await fetchRemoteEpisodeDetail(traceId);
    if (remote && remote.ok) {
      const data = await remote.json();
      res.status(remote.status).json(data);
      return;
    }

    const local = await getEpisodeLocally(traceId);
    res.status(200).json(local);
  } catch (error: any) {
    if (error?.status === 404 || /not found/i.test(error?.message ?? "")) {
      res.status(404).json({ error: { message: `episode ${traceId} not found` } });
      return;
    }
    const message = error?.message ?? "failed to load episode";
    res.status(500).json({ error: { message } });
  }
}
