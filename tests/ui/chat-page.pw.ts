import { expect, test } from "@playwright/test";

test.describe("Chat page", () => {
  test("renders responsive layout", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: /agentos · chat \+ logflow/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /run/i })).toBeVisible();

    const tokens = await page.evaluate(() => {
      const describeElement = (element: Element | null) => {
        if (!element) return null;
        const classAttr = element.getAttribute("class") ?? "";
        const classes = classAttr
          .split(/\s+/)
          .map((token) => token.trim())
          .filter((token) => token.length > 0)
          .sort();
        return {
          tag: element.tagName.toLowerCase(),
          classes,
        };
      };

      const buttonByText = (text: string) => {
        const target = text.trim().toLowerCase();
        return (
          Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
            (button) => (button.textContent ?? "").trim().toLowerCase() === target,
          ) ?? null
        );
      };

      const describeButton = (text: string) => {
        const element = buttonByText(text);
        if (!element) return null;
        const description = describeElement(element);
        return description
          ? {
              text,
              ...description,
            }
          : null;
      };

      const navButtons = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[data-testid="chat-nav"] button'),
      ).map((button) => {
        const description = describeElement(button);
        return description
          ? {
              text: (button.textContent ?? "").trim(),
              ...description,
            }
          : null;
      });

      return {
        shell: describeElement(document.querySelector('[data-testid="chat-shell"]')),
        header: describeElement(document.querySelector('[data-testid="chat-header"]')),
        main: describeElement(document.querySelector('[data-testid="chat-main"]')),
        nav: {
          container: describeElement(document.querySelector('[data-testid="chat-nav"]')),
          buttons: navButtons,
        },
        layout: describeElement(document.querySelector('[data-testid="chat-layout"]')),
        conversationPanel: describeElement(
          document.querySelector('[data-testid="conversation-panel"]'),
        ),
        sidebarPanels: describeElement(document.querySelector('[data-testid="sidebar-panels"]')),
        runStatsPanel: describeElement(document.querySelector('[data-testid="run-stats-panel"]')),
        rawResponsePanel: describeElement(
          document.querySelector('[data-testid="raw-response-panel"]'),
        ),
        chatLog: describeElement(document.querySelector('[role="log"]')),
        promptInput: describeElement(document.querySelector("#prompt")),
        runButton: describeButton("Run") ?? describeButton("Running…"),
        saveButton: describeButton("保存对话"),
        statusBadge: describeElement(
          document.querySelector('[data-testid="run-stats-panel"] span'),
        ),
      };
    });

    const snapshot = `${JSON.stringify(tokens, null, 2)}\n`;
    await expect(snapshot).toMatchSnapshot("chat-page-classes.json");
  });
});
