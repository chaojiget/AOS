import type { NextApiRequest, NextApiResponse } from "next";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const episodesDir = join(process.cwd(), "episodes");

type EpisodeResponse = string | { error: string; message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<EpisodeResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed", message: "only GET is allowed" });
    return;
  }

  const queryValue = req.query.trace_id;
  const traceId = Array.isArray(queryValue) ? queryValue[0] : queryValue;

  if (!traceId || typeof traceId !== "string") {
    res.status(400).json({ error: "invalid_trace_id", message: "trace_id is required" });
    return;
  }

  try {
    const file = await readFile(join(episodesDir, `${traceId}.jsonl`), "utf8");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${traceId}.jsonl"`);
    res.status(200).send(file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      res.status(404).json({ error: "not_found", message: `episode ${traceId} not found` });
      return;
    }
    const message = err instanceof Error ? err.message : "unknown error";
    res.status(500).json({ error: "read_failed", message });
  }
}
