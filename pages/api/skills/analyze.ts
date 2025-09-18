import type { NextApiRequest, NextApiResponse } from "next";

import { HeuristicSkillSummariser, runDefaultSkillAnalysis } from "../../../packages/skills/pipeline";
import type { SkillRecord } from "../../../packages/skills/storage";

type AnalyzeResponse = { ok: boolean; analyzed: number; candidates: SkillRecord[] };
type ErrorResponse = { error: string; message: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AnalyzeResponse | ErrorResponse>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res
      .status(405)
      .json({ error: "method_not_allowed", message: "Only POST is supported for this endpoint" });
    return;
  }

  try {
    const result = await runDefaultSkillAnalysis(new HeuristicSkillSummariser());
    res
      .status(202)
      .json({ ok: true, analyzed: result.analyzedEvents, candidates: result.candidates });
  } catch (error) {
    res
      .status(500)
      .json({ error: "analysis_failed", message: "Failed to analyse skill candidates" });
  }
}
