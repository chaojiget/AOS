import { expect, test } from "@playwright/test";

test.describe("Chat stream interactions", () => {
  test("replays SSE events and supports filtering", async ({ page }) => {
    await page.route("**/api/run", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trace_id: "trace-sse", events: [] }),
      });
    });

    await page.addInitScript(() => {
      const control: any = {
        instance: null,
        connect(instance: any) {
          this.instance = instance;
          setTimeout(() => {
            if (typeof instance.onopen === "function") {
              instance.onopen(new MessageEvent("open"));
            }
          }, 0);
        },
        emit(event: any) {
          if (this.instance && typeof this.instance.onmessage === "function") {
            this.instance.onmessage(new MessageEvent("message", { data: JSON.stringify(event) }));
          }
        },
        error() {
          if (this.instance && typeof this.instance.onerror === "function") {
            this.instance.onerror(new Event("error"));
          }
        },
      };
      (window as any).__AOS_STREAM_CONTROL__ = control;
      class MockEventSource {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSED = 2;
        url: string;
        readyState = MockEventSource.CONNECTING;
        onopen: ((event: MessageEvent) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        constructor(url: string) {
          this.url = url;
          this.readyState = MockEventSource.OPEN;
          control.connect(this);
        }
        addEventListener(type: string, listener: any) {
          if (type === "message") this.onmessage = listener;
          if (type === "error") this.onerror = listener;
          if (type === "open") this.onopen = listener;
        }
        removeEventListener(type: string) {
          if (type === "message") this.onmessage = null;
          if (type === "error") this.onerror = null;
          if (type === "open") this.onopen = null;
        }
        close() {
          this.readyState = MockEventSource.CLOSED;
        }
      }
      (window as any).EventSource = MockEventSource;
    });

    await page.goto("/");
    await page.getByLabel(/聊天输入|Chat input/i).fill("stream test");

    await Promise.all([
      page.waitForRequest("**/api/run"),
      page.getByRole("button", { name: /run|运行/i }).click(),
    ]);

    const emitEvents = async () => {
      const now = new Date().toISOString();
      await page.evaluate(
        ([timestamp]) => {
          const control = (window as any).__AOS_STREAM_CONTROL__;
          control.emit({
            id: "evt-plan",
            ts: timestamp,
            type: "plan.updated",
            data: {
              revision: 1,
              reason: "initial",
              steps: [
                { id: "step-1", title: "Collect data", description: "gather recent metrics" },
              ],
            },
          });
          control.emit({
            id: "evt-tool-start",
            ts: timestamp,
            type: "tool.started",
            span_id: "tool-1",
            data: {
              name: "search.docs",
              args: { query: "status report" },
            },
          });
          control.emit({
            id: "evt-tool-success",
            ts: timestamp,
            type: "tool.succeeded",
            span_id: "tool-1",
            data: {
              name: "search.docs",
              args: { query: "status report" },
              result: {
                text: "All systems nominal",
                latency_ms: 128,
                cost: 0.0025,
                tokens: 345,
              },
            },
          });
          control.emit({
            id: "evt-note",
            ts: timestamp,
            type: "reflect.note",
            data: { text: "Ready to summarise", level: "info" },
          });
          control.emit({
            id: "evt-confirm",
            ts: timestamp,
            type: "user.confirm.request",
            data: { prompt: "Allow publishing the summary?" },
          });
        },
        [now],
      );
    };

    await emitEvents();

    await expect(page.getByTestId("plan-events")).toContainText("Collect data");
    await page.getByTestId("plan-filter-input").fill("collect");
    await expect(page.getByTestId("plan-events")).toContainText("Collect data");

    const toolCard = page
      .getByTestId("skill-events")
      .getByRole("listitem")
      .filter({ hasText: /search\.docs/i });
    await expect(toolCard).toContainText(/已完成|succeeded/i);
    await expect(toolCard).toContainText(/0\.0025/);

    const confirmationModal = page.getByTestId("confirmation-modal");
    await expect(confirmationModal).toBeVisible();
    await confirmationModal.getByRole("button", { name: /允许|Allow/i }).click();
    await expect(confirmationModal).toBeHidden();

    await page.evaluate(
      ([timestamp]) => {
        const control = (window as any).__AOS_STREAM_CONTROL__;
        control.emit({
          id: "evt-final",
          ts: timestamp,
          type: "agent.final",
          data: { outputs: { text: "Summary" } },
        });
      },
      [new Date().toISOString()],
    );

    await expect(page.getByTestId("run-stats-panel")).toContainText(/Ready|就绪/);
    await expect(page.getByTestId("run-stats-panel")).toContainText(/345/);
    await expect(page.getByTestId("raw-response-panel")).toContainText("agent.final");
  });
});
