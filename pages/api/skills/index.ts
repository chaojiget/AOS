import type { NextApiRequest, NextApiResponse } from "next";

import {
  listSkills,
  setSkillEnabled,
  SkillNotFoundError,
  type SkillRecord,
} from "../../../packages/skills/storage";

type SkillsListResponse = { skills: SkillRecord[] };
type SkillMutationResponse = { skill: SkillRecord; skills: SkillRecord[] };
type ErrorResponse = { error: string; message: string };

function parseBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function parseString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function handleList(res: NextApiResponse<SkillsListResponse | ErrorResponse>) {
  try {
    const skills = await listSkills();
    res.status(200).json({ skills });
  } catch (error) {
    res
      .status(500)
      .json({ error: "skills_fetch_failed", message: "Failed to load skills metadata" });
  }
}

async function handleMutation(
  req: NextApiRequest,
  res: NextApiResponse<SkillMutationResponse | ErrorResponse>,
) {
  const { id, enabled } = req.body ?? {};

  if (!parseString(id) || !parseBoolean(enabled)) {
    res
      .status(400)
      .json({ error: "invalid_payload", message: "id and enabled fields are required" });
    return;
  }

  try {
    const updated = await setSkillEnabled(id, enabled);
    const skills = await listSkills();
    res.status(200).json({ skill: updated, skills });
  } catch (error) {
    if (error instanceof SkillNotFoundError) {
      res.status(404).json({ error: "skill_not_found", message: `Skill ${id} does not exist` });
      return;
    }
    res
      .status(500)
      .json({ error: "skills_update_failed", message: "Failed to update skill status" });
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SkillsListResponse | SkillMutationResponse | ErrorResponse>,
) {
  if (req.method === "GET") {
    await handleList(res);
    return;
  }

  if (req.method === "POST" || req.method === "PATCH") {
    await handleMutation(req, res);
    return;
  }

  res.setHeader("Allow", "GET,POST,PATCH");
  res
    .status(405)
    .json({ error: "method_not_allowed", message: "Only GET, POST and PATCH are supported" });
}
