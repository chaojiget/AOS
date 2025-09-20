import type { NextApiRequest, NextApiResponse } from "next";

import {
  fetchRemoteEpisodesList,
  listEpisodesLocally,
  parsePositiveInt,
} from "./utils";

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: { message: "Method Not Allowed" } });
    return;
  }

  const page = parsePositiveInt(req.query.page);
  const pageSize = parsePositiveInt(req.query.page_size);

  try {
    const remote = await fetchRemoteEpisodesList({ page, pageSize });
    if (remote && remote.ok) {
      const data = await remote.json();
      res.status(remote.status).json(data);
      return;
    }

    const local = await listEpisodesLocally({ page, pageSize });
    res.status(200).json(local);
  } catch (error: any) {
    const message = error?.message ?? "failed to fetch episodes";
    res.status(500).json({ error: { message } });
  }
}
