import "reflect-metadata";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";

import { AppModule } from "../../servers/api/src/app.module";
import { resetSkillsStore } from "../../packages/skills/storage";
import { DatabaseService } from "../../servers/api/src/database/database.service";
import { SkillsController } from "../../servers/api/src/skills/skills.controller";

describe("skills API", () => {
  const originalEnv = { ...process.env };

  it("analyzes tool events and exposes candidate skills", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "aos-skills-api-"));
    const eventsPath = join(tmpDir, "events.json");
    const skillsPath = join(tmpDir, "skills.json");
    const dbPath = join(tmpDir, "db.sqlite");
    const episodesDir = join(tmpDir, "episodes");

    process.env.AOS_EVENTS_PATH = eventsPath;
    process.env.AOS_SKILLS_PATH = skillsPath;
    process.env.AOS_DB_PATH = dbPath;
    process.env.AOS_EPISODES_DIR = episodesDir;
    process.env.AOS_API_KEY = "";

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

    await writeFile(eventsPath, JSON.stringify(events, null, 2), "utf8");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();

    const skillsController = app.get(SkillsController);
    const database = app.get(DatabaseService);
    if (database.db) {
      await resetSkillsStore(database.db, { skills: [] });
    }

    try {
      const analyzeRes = await skillsController.analyzeSkills();

      expect(analyzeRes.ok).toBe(true);
      expect(analyzeRes.analyzed).toBe(3);
      expect(Array.isArray(analyzeRes.candidates)).toBe(true);
      expect(analyzeRes.candidates[0]?.id).toBe("md.render");
      expect(analyzeRes.candidates[0]?.used_count).toBe(3);

      const candidatesRes = await skillsController.listCandidates();
      expect(Array.isArray(candidatesRes.candidates)).toBe(true);
      expect(candidatesRes.candidates[0]?.review_status).toBe("pending_review");
    } finally {
      await app.close();
      await rm(tmpDir, { recursive: true, force: true });
      if (database.db) {
        await resetSkillsStore(database.db, { skills: [] });
      }
      process.env = { ...originalEnv };
    }
  });
});
