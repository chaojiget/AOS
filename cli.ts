#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLoop, type CoreEvent, type EmitSpanOptions } from "./core/agent";
import { EventBus, wrapCoreEvent } from "./runtime/events";
import { EpisodeLogger } from "./runtime/episode";
import { replayEpisode } from "./runtime/replay";
import { createChatKernel, createDefaultToolInvoker } from "./adapters/core";
import { updateMCPRegistry, type MCPServerEntry } from "./config/mcpRegistry";

async function runOnce(message: string) {
  const traceId = randomUUID();
  const bus = new EventBus();
  const logger = new EpisodeLogger({ traceId });
  const toolInvoker = createDefaultToolInvoker({ eventBus: bus });
  const kernel = createChatKernel({ message, traceId, toolInvoker, history: [] });

  bus.subscribe((event: any) => {
    logEvent(event.data);
    logger.append(event).catch(console.error);
  });

  const emit = (event: CoreEvent, span?: EmitSpanOptions) => {
    bus.publish(wrapCoreEvent(traceId, event, span)).catch(console.error);
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

function printUsage() {
  console.log("Usage (after compiling to JavaScript):");
  console.log('  node dist/cli.js run "message"');
  console.log("  node dist/cli.js replay <trace_id>");
  console.log("  node dist/cli.js mcp add --transport <kind> <id> <url> [--default]");
}

function printMcpUsage() {
  console.log("MCP subcommands:");
  console.log("  mcp add --transport <kind> <id> <url> [--default]");
}

async function handleMcpAdd(args: string[]): Promise<number> {
  let transport: string | undefined;
  let setDefault = false;
  let registryPath: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--transport") {
      transport = args[i + 1];
      if (!transport) {
        console.error("Missing value for --transport option.");
        return 1;
      }
      i += 1;
      continue;
    }
    if (token === "--default") {
      setDefault = true;
      continue;
    }
    if (token === "--file" || token === "--registry") {
      registryPath = args[i + 1];
      if (!registryPath) {
        console.error(`Missing value for ${token} option.`);
        return 1;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--")) {
      console.error(`Unknown option: ${token}`);
      return 1;
    }
    positional.push(token);
  }

  const [id, url] = positional;
  if (!id) {
    console.error("Server id is required.");
    return 1;
  }
  if (!transport) {
    console.error("--transport option is required.");
    return 1;
  }

  const entry: MCPServerEntry = { id, transport };
  if (url) {
    entry.url = url;
  }

  let created = false;
  let updated = false;
  let defaultChanged = false;

  await updateMCPRegistry((registry) => {
    const index = registry.servers.findIndex((server) => server.id === id);
    if (index === -1) {
      registry.servers.push({ ...entry });
      created = true;
    } else {
      const existing = registry.servers[index];
      if (existing.transport !== transport || existing.url !== url) {
        registry.servers[index] = { ...existing, ...entry };
        updated = true;
      }
    }

    if (setDefault) {
      if (registry.defaultServerId !== id) {
        defaultChanged = true;
      }
      registry.defaultServerId = id;
    }
  }, registryPath);

  if (created) {
    console.log(
      `Registered MCP server "${id}" (${transport})${entry.url ? ` -> ${entry.url}` : ""}.`,
    );
  } else if (updated) {
    console.log(`Updated MCP server "${id}" (${transport}).`);
  } else {
    console.log(`MCP server "${id}" is already registered.`);
  }

  if (setDefault) {
    if (defaultChanged) {
      console.log(`Default MCP server set to "${id}".`);
    } else {
      console.log(`Default MCP server remains "${id}".`);
    }
  }

  return 0;
}

async function handleMcpCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "help") {
    printMcpUsage();
    return 0;
  }

  if (subcommand === "add") {
    return handleMcpAdd(rest);
  }

  console.error(`Unknown MCP subcommand: ${subcommand}`);
  return 1;
}

export async function runCLI(argv: string[]): Promise<number> {
  const [command, ...args] = argv;

  if (!command || command === "help") {
    printUsage();
    return 0;
  }

  if (command === "run") {
    const message = args.join(" ") || "Hello from CLI";
    await runOnce(message);
    return 0;
  }

  if (command === "replay") {
    const traceId = args[0];
    if (!traceId) {
      console.error("Trace id is required for replay.");
      return 1;
    }
    await replay(traceId);
    return 0;
  }

  if (command === "mcp") {
    return handleMcpCommand(args);
  }

  console.error(`Unknown command: ${command}`);
  return 1;
}

const isDirectExecution =
  typeof process !== "undefined" &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  runCLI(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) {
        process.exitCode = code;
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
