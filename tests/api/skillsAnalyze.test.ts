import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it } from "vitest";

import analyzeHandler from "../../pages/api/skills/analyze";
import candidatesHandler from "../../pages/api/skills/candidates";
import { resetSkillsStore } from "../../packages/skills/storage";

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

describe("/api/skills/analyze", () => {
  const originalEnv = { ...process.env };

  async function withTempFiles(fn: (dir: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "skills-analyze-"));
    process.env.AOS_EVENTS_PATH = join(dir, "events.json");
    process.env.AOS_SKILLS_PATH = join(dir, "skills.json");
    await resetSkillsStore({ skills: [], persist: true });
    try {
      await fn(dir);
    } finally {
      await resetSkillsStore();
      process.env = { ...originalEnv };
    }
  }

  it("triggers the skills pipeline and exposes candidate skills", async () => {
    await withTempFiles(async () => {
      const events = [
        {
          id: "evt-1",
          trace_id: "trace-1",
          tool_name: "md.render",
          timestamp: "2024-01-01T00:00:00.000Z",
          call_id: "call-1",
          success: true,
        },
        {
          id: "evt-2",
          trace_id: "trace-2",
          tool_name: "md.render",
          timestamp: "2024-01-01T00:01:00.000Z",
          call_id: "call-2",
          success: true,
        },
        {
          id: "evt-3",
          trace_id: "trace-3",
          tool_name: "md.render",
          timestamp: "2024-01-01T00:02:00.000Z",
          call_id: "call-3",
          success: false,
        },
      ];

      await writeFile(process.env.AOS_EVENTS_PATH!, JSON.stringify(events, null, 2), "utf8");

      const req = { method: "POST" } as NextApiRequest;
      const { res, state } = createMockResponse();

      await analyzeHandler(req, res);

      expect(state.statusCode).toBe(202);
      expect(state.body?.ok).toBe(true);
      expect(Array.isArray(state.body?.candidates)).toBe(true);
      expect(state.body?.candidates?.[0]?.id).toBe("md.render");
      expect(state.body?.candidates?.[0]?.used_count).toBe(3);

      const candidatesReq = { method: "GET" } as NextApiRequest;
      const { res: resCandidates, state: stateCandidates } = createMockResponse();
      await candidatesHandler(candidatesReq, resCandidates);

      expect(stateCandidates.statusCode).toBe(200);
      expect(Array.isArray(stateCandidates.body?.candidates)).toBe(true);
      expect(stateCandidates.body?.candidates?.[0]?.review_status).toBe("pending_review");
    });
  });
});
