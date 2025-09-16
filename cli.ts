#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { runLoop, type CoreEvent } from "./core/agent.js";
import { EventBus, wrapCoreEvent } from "./runtime/events.js";
import { EpisodeLogger } from "./runtime/episode.js";
import { replayEpisode } from "./runtime/replay.js";
import { createChatKernel, createDefaultToolInvoker } from "./adapters/core.js";

async function runOnce(message: string) {
  const traceId = randomUUID();
  const bus = new EventBus();
  const logger = new EpisodeLogger({ traceId });
  const toolInvoker = createDefaultToolInvoker();
  const kernel = createChatKernel({ message, traceId, toolInvoker });

  bus.subscribe((event: any) => {
    logEvent(event.data);
    logger.append(event).catch(console.error);
  });

  const emit = (event: CoreEvent) => {
    bus.publish(wrapCoreEvent(traceId, event)).catch(console.error);
  };
  const result = await runLoop(kernel, emit, {
    context: { traceId, input: message },
  });

  console.log("\nFinal output:", JSON.stringify(result.final, null, 2));
  console.log(`Episode saved to episodes/${traceId}.jsonl`);
}

function logEvent(event: CoreEvent) {
  const time = new Date().toISOString();
  switch (event.type) {
    case "progress":
      console.log(`[${time}] progress/${event.step} ${(event.pct * 100).toFixed(0)}%`);
      break;
    case "plan":
      console.log(`[${time}] plan revision=${event.revision} steps=${event.steps.length}`);
      break;
    case "tool":
      console.log(`[${time}] tool ${event.name}`, event.result);
      break;
    case "ask":
      console.log(`[${time}] ask ${event.question}`);
      break;
    case "score":
      console.log(`[${time}] score ${event.value} passed=${event.passed}`);
      break;
    case "final":
      console.log(`[${time}] final`, event.outputs);
      break;
    case "log":
      console.log(`[${time}] ${event.level}`, event.message);
      break;
  }
}

async function replay(traceId: string) {
  const events = await replayEpisode(traceId, {
    onEvent: (event: any) => {
      console.log(`${event.ts} ${event.type}`, event.data);
    },
  });
  console.log(`Replayed ${events.length} events.`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "help") {
    console.log("Usage (after compiling to JavaScript):");
    console.log('  node dist/cli.js run "message"');
    console.log("  node dist/cli.js replay <trace_id>");
    process.exit(0);
  }

  if (command === "run") {
    const message = args.join(" ") || "Hello from CLI";
    await runOnce(message);
    return;
  }

  if (command === "replay") {
    const traceId = args[0];
    if (!traceId) {
      console.error("Trace id is required for replay.");
      process.exit(1);
    }
    await replay(traceId);
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
