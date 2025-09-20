import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestApp, type TestAppContext } from "./support/testApp";
import { SkillsController } from "../../servers/api/src/skills/skills.controller";

describe("Skills controller", () => {
  let context: TestAppContext;
  let controller: SkillsController;

  beforeEach(async () => {
    context = await createTestApp();
    controller = context.moduleRef.get(SkillsController);
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("lists seeded skills", async () => {
    const response = await controller.listSkills();

    const skills = response.skills as any[];
    const ids = skills.map((skill) => skill.id);
    expect(ids).toContain("csv.clean");
  });

  it("enables a skill via the collection endpoint", async () => {
    const response = await controller.mutateSkill({ id: "md.render", enabled: true });

    expect(response.skill.id).toBe("md.render");
    expect(response.skill.enabled).toBe(true);
  });

  it("toggles a skill via the shortcut endpoint", async () => {
    const enable = await controller.enableSkill("md.render", { enabled: true });
    expect(enable.skill.enabled).toBe(true);

    const disable = await controller.enableSkill("md.render", { enabled: false });
    expect(disable.skill.enabled).toBe(false);
  });
});
