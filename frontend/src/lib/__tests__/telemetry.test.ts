import { buildSpanForest, type TelemetryLog } from "@/lib/telemetry";

describe("buildSpanForest", () => {
  it("builds virtual spans for OpenCode logs without span_id", () => {
    const logs: TelemetryLog[] = [
      {
        id: 1,
        timestamp: "2025-12-17T00:00:00.000Z",
        trace_id: "ses_abc",
        span_id: null,
        parent_span_id: null,
        span_name: null,
        level: "INFO",
        logger_name: "opencode",
        message: "session.updated",
        attributes: {
          type: "session.updated",
          tags: ["opencode", "session.updated"],
          trace_id: "ses_abc",
          project: { id: "proj_1" },
          directory: "/tmp/demo",
          properties: { info: { id: "ses_abc" } },
        },
      },
      {
        id: 2,
        timestamp: "2025-12-17T00:00:01.000Z",
        trace_id: "ses_abc",
        span_id: null,
        parent_span_id: null,
        span_name: null,
        level: "INFO",
        logger_name: "opencode",
        message: "message.part.updated",
        attributes: {
          type: "message.part.updated",
          tags: ["opencode", "message.part.updated"],
          trace_id: "ses_abc",
          project: { id: "proj_1" },
          directory: "/tmp/demo",
          properties: { part: { sessionID: "ses_abc", messageID: "msg_123", type: "text", text: "hi" } },
        },
      },
    ];

    const forest = buildSpanForest(logs);

    expect(forest.orphanLogs).toHaveLength(0);

    const root = forest.byId.get("oc:trace:ses_abc");
    expect(root).toBeDefined();
    expect(root?.name).toBe("OpenCode (proj_1)");

    const messageSpan = forest.byId.get("oc:message:msg_123");
    expect(messageSpan).toBeDefined();
    expect(messageSpan?.parentSpanId).toBe("oc:trace:ses_abc");
    expect(messageSpan?.logs).toHaveLength(1);

    expect(forest.roots.map((n) => n.spanId)).toContain("oc:trace:ses_abc");
  });
});

