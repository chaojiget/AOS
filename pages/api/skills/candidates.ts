import type { NextApiRequest, NextApiResponse } from "next";

import { listSkills, type SkillRecord } from "../../../packages/skills/storage";

type CandidatesResponse = { candidates: SkillRecord[] };
type ErrorResponse = { error: string; message: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CandidatesResponse | ErrorResponse>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res
      .status(405)
      .json({ error: "method_not_allowed", message: "Only GET is supported for this endpoint" });
    return;
  }

  try {
    const skills = await listSkills();
    const candidates = skills.filter((skill) => skill.review_status !== "approved");
    res.status(200).json({ candidates });
  } catch (error) {
    res
      .status(500)
      .json({ error: "candidates_fetch_failed", message: "Failed to load candidate skills" });
  }
}
