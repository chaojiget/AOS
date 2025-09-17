import { expect, test } from "@playwright/test";

test("user can toggle a skill from the skills page", async ({ page }) => {
  await page.goto("/skills");

  await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Launch Run" })).toBeVisible();

  const firstSkillCard = page.getByTestId("skill-card").first();
  await expect(firstSkillCard).toBeVisible();

  const statusChip = firstSkillCard.getByTestId("skill-status");
  const initialStatus = (await statusChip.textContent())?.trim() ?? "";
  expect(initialStatus === "Enabled" || initialStatus === "Disabled").toBe(true);

  const toggleButton = firstSkillCard.getByRole("button", { name: /Enable|Disable|Updating/ });
  await toggleButton.click();

  const expectedAfterToggle = initialStatus === "Enabled" ? "Disabled" : "Enabled";
  await expect(statusChip).toHaveText(expectedAfterToggle);

  await toggleButton.click();
  await expect(statusChip).toHaveText(initialStatus);
});
