#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { addOrUpdateMCPServer } from "./config/mcpRegistry";
import { runLoop, type CoreEvent, type EmitSpanOptions } from "./core/agent";
import { EventBus, wrapCoreEvent } from "./runtime/events";
import { EpisodeLogger } from "./runtime/episode";
import { replayEpisode } from "./runtime/replay";
import { createChatKernel, createDefaultToolInvoker } from "./adapters/core";

interface Writer {
  write(chunk: string): unknown;
}

interface CliStreams {
  stdout: Writer;
  stderr: Writer;
}

export interface RunCliOptions {
  stdout?: Writer;
  stderr?: Writer;
  cwd?: string;
}

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

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const streams = resolveCliStreams(options);
  const cwd = options.cwd ?? process.cwd();
  const [command, ...args] = argv;

  if (!command || command === "help") {
    streams.stdout.write("Usage (after compiling to JavaScript):\n");
    streams.stdout.write('  node dist/cli.js run "message"\n');
    streams.stdout.write("  node dist/cli.js replay <trace_id>\n");
    streams.stdout.write("  node dist/cli.js mcp add --transport <type> <id> <url> [--default]\n");
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
      streams.stderr.write("Trace id is required for replay.\n");
      return 1;
    }
    await replay(traceId);
    return 0;
  }

  if (command === "mcp") {
    return handleMcpCommand(args, { streams, cwd });
  }

  streams.stderr.write(`Unknown command: ${command}\n`);
  return 1;
}

export async function runCLI(argv: string[], options?: RunCliOptions): Promise<number> {
  return runCli(argv, options);
}

function resolveCliStreams(options: RunCliOptions): CliStreams {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  return { stdout, stderr };
}

async function handleMcpCommand(args: string[], context: { streams: CliStreams; cwd: string }): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "help") {
    context.streams.stdout.write("Usage: mcp add --transport <type> <id> <url> [--default]\n");
    return 0;
  }

  if (subcommand !== "add") {
    context.streams.stderr.write(`Unknown MCP command: ${subcommand}\n`);
    return 1;
  }

  const parsed = parseMcpAddArgs(rest);
  if (parsed.error) {
    context.streams.stderr.write(`${parsed.error}\n`);
    return 1;
  }

  const result = await addOrUpdateMCPServer({
    id: parsed.id,
    transport: parsed.transport,
    url: parsed.url,
    setAsDefault: parsed.setAsDefault,
    registryPath: resolvePath(context.cwd, "mcp.registry.json"),
  });

  if (result.action === "created") {
    context.streams.stdout.write(`已添加 MCP 端点 "${parsed.id}" (transport: ${parsed.transport})。\n`);
  } else if (result.action === "updated") {
    context.streams.stdout.write(`已更新 MCP 端点 "${parsed.id}" 的配置。\n`);
  } else {
    context.streams.stdout.write(`MCP 端点 "${parsed.id}" 配置未变。\n`);
  }

  if (parsed.setAsDefault) {
    if (result.defaultChanged) {
      context.streams.stdout.write(`已将 "${parsed.id}" 设置为默认端点。\n`);
    } else {
      context.streams.stdout.write(`"${parsed.id}" 已经是默认端点。\n`);
    }
  }

  return 0;
}

interface ParsedMcpAddArgs {
  id: string;
  url: string;
  transport: string;
  setAsDefault: boolean;
  error?: undefined;
}

interface ParsedMcpAddArgsError {
  error: string;
}

function parseMcpAddArgs(args: string[]): ParsedMcpAddArgs | ParsedMcpAddArgsError {
  let transport: string | undefined;
  let setAsDefault = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--transport") {
      const value = args[i + 1];
      if (!value) {
        return { error: "参数 --transport 需要一个值" };
      }
      transport = value;
      i += 1;
      continue;
    }
    if (arg === "--default") {
      setAsDefault = true;
      continue;
    }
    positional.push(arg);
  }

  if (!transport) {
    return { error: "请通过 --transport 指定端点传输类型。" };
  }

  const [id, url] = positional;
  if (!id) {
    return { error: "请提供端点 ID。" };
  }
  if (!url) {
    return { error: "请提供端点 URL。" };
  }

  return { id, url, transport, setAsDefault };
}

if (process.argv[1]) {
  const entryUrl = pathToFileURL(process.argv[1]).href;
  if (import.meta.url === entryUrl) {
    runCli(process.argv.slice(2))
      .then((code) => {
        process.exitCode = code;
      })
      .catch((err) => {
        console.error(err);
        process.exitCode = 1;
      });
  }
}
