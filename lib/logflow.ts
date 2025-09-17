import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { EventEnvelope } from "../runtime/events";
import { readEpisodeIndex } from "../runtime/episode";
import type { BranchNode, EpisodeIndexEntry, LogFlowMessage } from "../types/logflow";

const DEFAULT_EPISODE_DIR = join(process.cwd(), "episodes");

async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  const content = await readFile(filePath, "utf8");
  if (!content) {
    return [];
  }
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function readEpisodeEvents(
  traceId: string,
  dir: string = DEFAULT_EPISODE_DIR,
): Promise<EventEnvelope[]> {
  const filePath = join(dir, `${traceId}.jsonl`);
  const events = await readJsonlFile<EventEnvelope>(filePath);
  return events.sort((a, b) => (a.ln ?? 0) - (b.ln ?? 0));
}

export async function readEpisodeIndexEntries(
  traceId: string,
  dir: string = DEFAULT_EPISODE_DIR,
): Promise<EpisodeIndexEntry[]> {
  return readEpisodeIndex(traceId, dir);
}

function summarizeEvent(event: EventEnvelope): string {
  const data = event.data as any;
  switch (event.type) {
    case "agent.plan": {
      const steps = Array.isArray(data?.steps) ? data.steps.length : 0;
      const revision = data?.revision ?? "?";
      return `Plan revision ${revision} with ${steps} step${steps === 1 ? "" : "s"}`;
    }
    case "agent.tool":
      return `Tool ${data?.name ?? "(unknown)"}`;
    case "agent.final":
      return "Final output ready";
    case "agent.ask":
      return data?.question ? `Ask: ${data.question}` : "Ask";
    case "agent.score":
      return `Score ${data?.value ?? "?"} (${data?.passed ? "pass" : "fail"})`;
    case "agent.progress":
      return `Progress ${Math.round((data?.pct ?? 0) * 100)}% (${data?.step ?? "step"})`;
    case "agent.log":
      return typeof data?.message === "string" ? data.message : "Log";
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
    message: summarizeEvent(event),
    data: event.data,
    byte_offset: event.byte_offset,
  } satisfies LogFlowMessage;
}

interface MutableBranchNode {
  span_id: string;
  parent_span_id?: string;
  first_ln: number;
  last_ln: number;
  events: LogFlowMessage[];
  children: MutableBranchNode[];
}

export function buildBranchTree(
  messages: LogFlowMessage[],
  originSpanId: string,
): BranchNode | null {
  const nodes = new Map<string, MutableBranchNode>();

  for (const message of messages) {
    if (!message.span_id) continue;
    let node = nodes.get(message.span_id);
    if (!node) {
      node = {
        span_id: message.span_id,
        parent_span_id: message.parent_span_id,
        first_ln: message.ln,
        last_ln: message.ln,
        events: [],
        children: [],
      } satisfies MutableBranchNode;
      nodes.set(message.span_id, node);
    }
    node.parent_span_id = message.parent_span_id ?? node.parent_span_id;
    node.events.push(message);
    node.first_ln = Math.min(node.first_ln, message.ln);
    node.last_ln = Math.max(node.last_ln, message.ln);

    if (message.parent_span_id && !nodes.has(message.parent_span_id)) {
      nodes.set(
        message.parent_span_id,
        {
          span_id: message.parent_span_id,
          parent_span_id: undefined,
          first_ln: message.ln,
          last_ln: message.ln,
          events: [],
          children: [],
        } satisfies MutableBranchNode,
      );
    }
  }

  if (!nodes.size || !nodes.has(originSpanId)) {
    return null;
  }

  for (const node of nodes.values()) {
    node.events.sort((a, b) => a.ln - b.ln);
  }

  for (const node of nodes.values()) {
    if (!node.parent_span_id) continue;
    const parent = nodes.get(node.parent_span_id);
    if (parent && !parent.children.includes(node)) {
      parent.children.push(node);
      parent.first_ln = Math.min(parent.first_ln, node.first_ln);
      parent.last_ln = Math.max(parent.last_ln, node.last_ln);
    }
  }

  for (const node of nodes.values()) {
    node.children.sort((a, b) => a.first_ln - b.first_ln);
  }

  const visited = new Set<string>();
  const toBranch = (node: MutableBranchNode): BranchNode => {
    if (visited.has(node.span_id)) {
      return {
        span_id: node.span_id,
        parent_span_id: node.parent_span_id,
        first_ln: node.first_ln,
        last_ln: node.last_ln,
        events: node.events,
        children: [],
      } satisfies BranchNode;
    }
    visited.add(node.span_id);
    const children = node.children.map(toBranch);
    const firstLn = children.reduce(
      (min, child) => Math.min(min, child.first_ln),
      node.events.length ? Math.min(...node.events.map((evt) => evt.ln), node.first_ln) : node.first_ln,
    );
    const lastLn = children.reduce(
      (max, child) => Math.max(max, child.last_ln),
      node.events.length ? Math.max(...node.events.map((evt) => evt.ln), node.last_ln) : node.last_ln,
    );
    return {
      span_id: node.span_id,
      parent_span_id: node.parent_span_id,
      first_ln: firstLn,
      last_ln: lastLn,
      events: node.events,
      children,
    } satisfies BranchNode;
  };

  const root = nodes.get(originSpanId);
  if (!root) {
    return null;
  }
  return toBranch(root);
}
