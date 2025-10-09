import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import vm from 'vm';
import {
  SandboxEnvironmentDefinition,
  SandboxRunResult,
  SandboxScriptDefinition,
  SandboxRunTrigger,
} from './types';
import {
  deleteEnvironmentFromStorage,
  deleteScriptFromStorage,
  loadSandboxEnvironments,
  loadScriptsFromStorage,
  saveEnvironmentToStorage,
  saveScriptToStorage,
} from './storage';
import { logSandboxRun } from './run-logger';
import { logClient } from '../services/log-client';

const DEFAULT_ENVIRONMENT_NAME = '默认虚拟环境';

export class McpSandbox {
  private readonly environments = new Map<string, SandboxEnvironmentDefinition>();
  private readonly scripts = new Map<string, SandboxScriptDefinition>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  async hydrate(): Promise<void> {
    const environments = await loadSandboxEnvironments();
    this.environments.clear();
    for (const env of environments) {
      await this.registerEnvironment(env, { persist: false });
    }
    const scripts = await loadScriptsFromStorage();
    this.scripts.clear();
    for (const script of scripts) {
      await this.register(script, { persist: false });
    }
    await this.ensureDefaultEnvironment();
  }

  list(): Array<SandboxScriptDefinition & { environment?: { id: string; name: string; description?: string } | null }> {
    return Array.from(this.scripts.values()).map((script) => {
      const environment = script.environmentId ? this.environments.get(script.environmentId) ?? null : null;
      return {
        ...script,
        environment: environment
          ? { id: environment.id, name: environment.name, description: environment.description }
          : null,
      };
    });
  }

  listEnvironments(): SandboxEnvironmentDefinition[] {
    return Array.from(this.environments.values());
  }

  get(id: string): SandboxScriptDefinition | undefined {
    return this.scripts.get(id);
  }

  getEnvironment(id: string): SandboxEnvironmentDefinition | undefined {
    return this.environments.get(id);
  }

  async ensureDefaultEnvironment(): Promise<SandboxEnvironmentDefinition | null> {
    if (this.environments.size > 0) {
      const existingDefault = Array.from(this.environments.values()).find(
        (env) => env.name === DEFAULT_ENVIRONMENT_NAME,
      );
      return existingDefault ?? null;
    }
    const environment: SandboxEnvironmentDefinition = {
      id: randomUUID(),
      name: DEFAULT_ENVIRONMENT_NAME,
      description: '系统自动创建的空白虚拟环境，可直接使用或后续编辑。',
      variables: {},
    };
    return await this.registerEnvironment(environment);
  }

  async registerEnvironment(
    def: SandboxEnvironmentDefinition,
    options: { persist?: boolean } = {},
  ): Promise<SandboxEnvironmentDefinition> {
    const definition: SandboxEnvironmentDefinition = {
      ...def,
      variables: def.variables ?? {},
    };
    this.environments.set(definition.id, definition);
    if (options.persist !== false) {
      await saveEnvironmentToStorage(definition);
    }
    return definition;
  }

  async register(def: SandboxScriptDefinition, options: { persist?: boolean } = {}): Promise<SandboxScriptDefinition> {
    if (!path.isAbsolute(def.entryFile)) {
      throw new Error('沙箱脚本入口必须为绝对路径');
    }

    if (def.environmentId) {
      const environment = this.environments.get(def.environmentId);
      if (!environment) {
        throw new Error('绑定的虚拟环境不存在或已删除');
      }
    }

    const definition = {
      ...def,
      env: def.env ?? undefined,
      scheduleMs: def.scheduleMs ?? undefined,
      environmentId: def.environmentId ?? null,
    };

    this.unregister(definition.id);
    this.scripts.set(definition.id, definition);
    this.setupTimer(definition);

    if (options.persist !== false) {
      await saveScriptToStorage(definition);
    }

    return definition;
  }

  async removeEnvironment(id: string): Promise<boolean> {
    if (Array.from(this.scripts.values()).some((script) => script.environmentId === id)) {
      throw new Error('仍有脚本绑定该虚拟环境，请先在脚本中解除引用');
    }
    const existed = this.environments.delete(id);
    if (existed) {
      await deleteEnvironmentFromStorage(id);
    }
    return existed;
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
    const environment = script.environmentId ? this.environments.get(script.environmentId) ?? null : null;

    const startedAt = new Date();
    const trigger: SandboxRunTrigger = options.trigger ?? 'manual';
    const runId = randomUUID();
    await logClient.write({
      level: 'info',
      message: `[Sandbox:${script.id}] 脚本开始执行`,
      traceId: runId,
      topic: 'sandbox.run.start',
      attributes: {
        scriptId: id,
        scriptName: script.name,
        trigger,
        actor: options.actor,
        environmentId: environment?.id ?? null,
        environmentName: environment?.name ?? null,
      },
    });
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
    const environmentVars = environment?.variables ?? {};
    const mergedEnv = { ...process.env, ...environmentVars, ...(script.env ?? {}) };

    const context: Record<string, unknown> = {
      console: sandboxConsole,
      module: moduleRef,
      exports: moduleRef.exports,
      process: { env: mergedEnv },
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

    try {
      await logSandboxRun({
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

    await logClient.write({
      level: errorMessage ? 'error' : 'info',
      message: `[Sandbox:${script.id}] 脚本执行${errorMessage ? '失败' : '完成'}`,
      traceId: runId,
      topic: errorMessage ? 'sandbox.run.error' : 'sandbox.run.success',
      attributes: {
        scriptId: id,
        scriptName: script.name,
        trigger,
        actor: options.actor,
        durationMs,
        environmentId: environment?.id ?? null,
        environmentName: environment?.name ?? null,
      },
    });

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
