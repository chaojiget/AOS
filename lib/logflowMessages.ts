import type { EventEnvelope } from "../runtime/events";
import type { LogFlowMessage } from "../types/logflow";

function summarise(event: EventEnvelope): string {
  const data = event.data as any;
  switch (event.type) {
    case "plan.updated": {
      const steps = Array.isArray(data?.steps) ? data.steps.length : 0;
      const revision = data?.revision ?? "?";
      return `Plan revision ${revision} with ${steps} step${steps === 1 ? "" : "s"}`;
    }
    case "tool.started":
      return `Tool ${data?.name ?? "(unknown)"} started`;
    case "tool.succeeded":
      return `Tool ${data?.name ?? "(unknown)"} succeeded`;
    case "tool.failed":
      return `Tool ${data?.name ?? "(unknown)"} failed`;
    case "run.started":
      return "Run started";
    case "run.progress":
      return `Progress ${Math.round((data?.pct ?? 0) * 100)}% (${data?.step ?? "step"})`;
    case "run.finished":
      return `Run finished (${data?.reason ?? "completed"})`;
    case "final.answer":
      return "Final answer ready";
    case "run.failed":
      return `Run failed${data?.message ? `: ${data.message}` : ""}`;
    case "run.ask":
      return data?.question ? `Ask: ${data.question}` : "Ask";
    case "run.score":
      return `Score ${data?.value ?? "?"} (${data?.passed ? "pass" : "fail"})`;
    case "run.log":
      return typeof data?.message === "string" ? data.message : "Log";
    case "reflect.note":
      return typeof data?.text === "string" ? data.text : "Reflection";
    case "skill.used":
      return `Skill ${data?.name ?? "(unknown)"} used`;
    default:
      return event.type;
  }
}

export function toLogFlowMessage(event: EventEnvelope): LogFlowMessage {
  return {
    id: event.id,
    ln: event.ln ?? 0,
    span_id: event.span_id,
    parent_span_id: event.parent_span_id,
    type: event.type,
    ts: event.ts,
    level: event.level,
    message: summarise(event),
    data: event.data,
    byte_offset: event.byte_offset,
  } satisfies LogFlowMessage;
}
