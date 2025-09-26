import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import vm from 'vm';
import { SandboxRunResult, SandboxScriptDefinition, SandboxRunTrigger } from './types';
import { deleteScriptFromStorage, loadScriptsFromStorage, saveScriptToStorage } from './storage';
import { logSandboxRun } from './run-logger';

export class McpSandbox {
  private readonly scripts = new Map<string, SandboxScriptDefinition>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  async hydrate(): Promise<void> {
    const scripts = await loadScriptsFromStorage();
    this.scripts.clear();
    for (const script of scripts) {
      await this.register(script, { persist: false });
    }
  }

  list(): SandboxScriptDefinition[] {
    return Array.from(this.scripts.values());
  }

  get(id: string): SandboxScriptDefinition | undefined {
    return this.scripts.get(id);
  }

  async register(def: SandboxScriptDefinition, options: { persist?: boolean } = {}): Promise<SandboxScriptDefinition> {
    if (!path.isAbsolute(def.entryFile)) {
      throw new Error('沙箱脚本入口必须为绝对路径');
    }

    const definition = { ...def, env: def.env ?? undefined, scheduleMs: def.scheduleMs ?? undefined };

    this.unregister(definition.id);
    this.scripts.set(definition.id, definition);
    this.setupTimer(definition);

    if (options.persist !== false) {
      await saveScriptToStorage(definition);
    }

    return definition;
  }

  unregister(id: string): boolean {
    const removed = this.scripts.delete(id);
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
    return removed;
  }

  async remove(id: string): Promise<boolean> {
    const existed = this.scripts.has(id);
    this.unregister(id);
    await deleteScriptFromStorage(id);
    return existed;
  }

  private setupTimer(def: SandboxScriptDefinition) {
    if (!def.scheduleMs || def.scheduleMs <= 0) {
      return;
    }
    const timer = setInterval(() => {
      this.run(def.id, { trigger: 'schedule' }).catch((error) => {
        console.error(`[Sandbox:${def.id}] 定时执行失败`, error);
      });
    }, def.scheduleMs);
    this.timers.set(def.id, timer);
  }

  async run(id: string, options: { trigger?: SandboxRunTrigger; actor?: string } = {}): Promise<SandboxRunResult> {
    const script = this.scripts.get(id);
    if (!script) {
      throw new Error(`未找到脚本 ${id}`);
    }

    const startedAt = new Date();
    const trigger: SandboxRunTrigger = options.trigger ?? 'manual';
    const code = await fs.readFile(script.entryFile, 'utf-8');

    const captured: string[] = [];
    const sandboxConsole = {
      log: (...args: unknown[]) => captured.push(args.map(String).join(' ')),
      error: (...args: unknown[]) => captured.push(args.map(String).join(' ')),
      warn: (...args: unknown[]) => captured.push(args.map(String).join(' ')),
      info: (...args: unknown[]) => captured.push(args.map(String).join(' ')),
      debug: (...args: unknown[]) => captured.push(args.map(String).join(' ')),
    };

    const moduleRef: { exports: Record<string, unknown> } = { exports: {} };

    const context: Record<string, unknown> = {
      console: sandboxConsole,
      module: moduleRef,
      exports: moduleRef.exports,
      process: { env: { ...process.env, ...(script.env ?? {}) } },
      Buffer,
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
    };

    const vmContext = vm.createContext(context, { name: `sandbox:${script.id}` });

    let errorMessage: string | undefined;
    try {
      const scriptRunner = new vm.Script(code, {
        filename: script.entryFile,
      });
      const result = scriptRunner.runInContext(vmContext, {
        timeout: 15_000,
      });
      const exported = moduleRef.exports;
      if (typeof (exported as any).run === 'function') {
        await Promise.resolve((exported as any).run());
      } else if (typeof result === 'function') {
        await Promise.resolve(result());
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : '未知错误';
    }

    const finishedAt = new Date();
    const output = captured.join('\n');
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    let runId: string = randomUUID();
    try {
      runId = await logSandboxRun({
        runId,
        scriptId: id,
        scriptName: script.name,
        output,
        error: errorMessage,
        startedAt,
        finishedAt,
        trigger,
        actor: options.actor,
      });
    } catch (logError) {
      console.error(`[Sandbox:${id}] 记录运行结果失败`, logError);
    }

    return {
      runId,
      scriptId: id,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs,
      output,
      status: errorMessage ? 'error' : 'success',
      trigger,
      error: errorMessage,
      actor: options.actor,
    };
  }
}

export const mcpSandbox = new McpSandbox();
