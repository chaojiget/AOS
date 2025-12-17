import { buildDeepTraceStore, buildVisibleSpanIds, computeCriticalPath } from "@/lib/deep-trace";
import type { TelemetryLog } from "@/lib/telemetry";

describe("deep-trace store", () => {
  it("normalizes spans into lookup tables and aggregates errors/time", () => {
    const logs: TelemetryLog[] = [
      {
        id: 1,
        timestamp: "2025-12-17T00:00:00.000Z",
        trace_id: "t1",
        span_id: "a",
        level: "INFO",
        logger_name: "demo",
        message: "root",
        attributes: { otel: { span_id: "a", parent_span_id: null, span_name: "root-span" } },
      },
      {
        id: 2,
        timestamp: "2025-12-17T00:00:01.000Z",
        trace_id: "t1",
        span_id: "b",
        level: "ERROR",
        logger_name: "demo",
        message: "child error",
        attributes: { otel: { span_id: "b", parent_span_id: "a", span_name: "child-span" } },
      },
      {
        id: 3,
        timestamp: "2025-12-17T00:00:02.000Z",
        trace_id: "t1",
        span_id: "b",
        level: "INFO",
        logger_name: "demo",
        message: "child end",
        attributes: { otel: { span_id: "b", parent_span_id: "a", span_name: "child-span" } },
      },
    ];

    const store = buildDeepTraceStore(logs);

    expect(store.meta.traceId).toBe("t1");
    expect(store.meta.rootSpanIds).toEqual(["a"]);
    expect(store.meta.totalDurationMs).toBe(2000);

    expect(store.spans.a.children).toEqual(["b"]);
    expect(store.spans.a.totalErrorCount).toBe(1);
    expect(store.spans.a.depth).toBe(0);

    expect(store.spans.b.parentId).toBe("a");
    expect(store.spans.b.totalErrorCount).toBe(1);
    expect(store.spans.b.depth).toBe(1);
    expect(store.spans.b.startOffsetMs).toBe(1000);
    expect(store.spans.b.endOffsetMs).toBe(2000);

    expect(buildVisibleSpanIds(store, new Set(["a"]))).toEqual(["a"]);
    expect(computeCriticalPath(store)).toEqual(new Set(["a", "b"]));
  });
});

