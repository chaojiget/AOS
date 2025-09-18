import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it } from "vitest";

import handler from "../pages/api/skills/index";
import { DEFAULT_SKILLS, listSkills, resetSkillsStore } from "../packages/skills/storage";

interface MockResponseState {
  statusCode: number;
  body?: any;
}

function createMockResponse(): { res: NextApiResponse; state: MockResponseState } {
  const state: MockResponseState = { statusCode: 0 };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(payload: any) {
      state.body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
  } as unknown as NextApiResponse;
  return { res, state };
}

async function withTempSkillsStore(run: () => Promise<void>): Promise<void> {
  const originalEnv = { ...process.env };
  const dir = await mkdtemp(join(tmpdir(), "skills-api-"));
  process.env.AOS_SKILLS_PATH = join(dir, "skills.json");
  await resetSkillsStore({ persist: true });
  try {
    await run();
  } finally {
    await resetSkillsStore();
    process.env = { ...originalEnv };
  }
}

describe("/api/skills", () => {
  it("returns the registered skills", async () => {
    await withTempSkillsStore(async () => {
      const req = { method: "GET" } as NextApiRequest;
      const { res, state } = createMockResponse();

      await handler(req, res);

      expect(state.statusCode).toBe(200);
      expect(Array.isArray(state.body?.skills)).toBe(true);
      expect(state.body.skills).toHaveLength(DEFAULT_SKILLS.length);
    });
  });

  it("updates the skill status", async () => {
    await withTempSkillsStore(async () => {
      const initialSkills = await listSkills();
      const skill = initialSkills[0];
      const req = {
        method: "POST",
        body: { id: skill.id, enabled: !skill.enabled },
      } as NextApiRequest;
      const { res, state } = createMockResponse();

      await handler(req, res);

      expect(state.statusCode).toBe(200);
      expect(state.body?.skill?.id).toBe(skill.id);
      expect(state.body?.skill?.enabled).toBe(!skill.enabled);
      expect(state.body?.skills?.find((item: any) => item.id === skill.id)?.enabled).toBe(
        !skill.enabled,
      );
    });
  });

  it("returns 404 when the skill is missing", async () => {
    await withTempSkillsStore(async () => {
      const req = {
        method: "POST",
        body: { id: "missing-skill", enabled: true },
      } as NextApiRequest;
      const { res, state } = createMockResponse();

      await handler(req, res);

      expect(state.statusCode).toBe(404);
      expect(state.body?.error).toBe("skill_not_found");
    });
  });

  it("rejects invalid payloads", async () => {
    await withTempSkillsStore(async () => {
      const req = {
        method: "POST",
        body: { id: "", enabled: "true" },
      } as NextApiRequest;
      const { res, state } = createMockResponse();

      await handler(req, res);

      expect(state.statusCode).toBe(400);
      expect(state.body?.error).toBe("invalid_payload");
    });
  });
});
