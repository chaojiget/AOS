import { McpServerConfig } from './types';
import {
  McpPolicyRecord,
  loadPoliciesFromStorage,
  savePolicyToStorage,
} from './storage';

type HealthState = 'healthy' | 'degraded' | 'unreachable';

export interface QuotaPolicy {
  limitPerMinute?: number;
  burstMultiplier?: number;
}

export interface CircuitBreakerPolicy {
  failureThreshold: number;
  cooldownSeconds: number;
  minimumSamples?: number;
}

export interface ServicePolicy {
  quota?: QuotaPolicy;
  circuitBreaker?: CircuitBreakerPolicy;
}

interface ManualCheck {
  status: HealthState;
  checkedAt: number;
  latencyMs?: number;
  message?: string;
}

interface CallSample {
  timestamp: number;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
}

interface ServiceMetrics {
  policy: ServicePolicy;
  calls: CallSample[];
  quotaWindow: number[];
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastErrorMessage?: string;
  consecutiveFailures: number;
  circuitOpenUntil?: number;
  lastManualCheck?: ManualCheck;
}

export interface ServiceStatus {
  name: string;
  health: HealthState;
  message?: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastCheckedAt?: string;
  lastManualCheck?: {
    status: HealthState;
    latencyMs?: number;
    message?: string;
    checkedAt: string;
  };
  metrics: {
    totalCalls: number;
    successCount: number;
    failureCount: number;
    errorRate: number;
    p50Latency?: number;
    p95Latency?: number;
    consecutiveFailures: number;
  };
  policy: ServicePolicy;
  quota: {
    limitPerMinute?: number;
    currentUsage: number;
    burstMultiplier: number;
  };
  circuit: {
    open: boolean;
    releaseAt?: string;
  };
}

const MAX_SAMPLES = 200;

const defaultCircuitPolicy: CircuitBreakerPolicy = {
  failureThreshold: 3,
  cooldownSeconds: 60,
  minimumSamples: 5,
};

const defaultQuotaPolicy: QuotaPolicy = {
  limitPerMinute: undefined,
  burstMultiplier: 1.2,
};

class McpServiceMonitor {
  private readonly metrics = new Map<string, ServiceMetrics>();

  async hydrate(services: McpServerConfig[]): Promise<void> {
    const policies = await loadPoliciesFromStorage();
    const policyMap = new Map<string, McpPolicyRecord>(policies.map((item) => [item.name, item]));
    for (const service of services) {
      const existing = this.metrics.get(service.name);
      if (existing) {
        const refreshedPolicy = this.composePolicy(policyMap.get(service.name));
        existing.policy = refreshedPolicy;
        continue;
      }
      this.metrics.set(service.name, {
        policy: this.composePolicy(policyMap.get(service.name)),
        calls: [],
        quotaWindow: [],
        consecutiveFailures: 0,
      });
    }

    for (const name of Array.from(this.metrics.keys())) {
      if (!services.find((service) => service.name === name)) {
        this.metrics.delete(name);
      }
    }
  }

  register(service: McpServerConfig): void {
    const existing = this.metrics.get(service.name);
    if (existing) return;
    this.metrics.set(service.name, {
      policy: this.composePolicy(),
      calls: [],
      quotaWindow: [],
      consecutiveFailures: 0,
    });
  }

  unregister(name: string): void {
    this.metrics.delete(name);
  }

  setPolicy(name: string, policy: ServicePolicy): void {
    const metrics = this.ensureMetrics(name);
    metrics.policy = {
      quota: policy.quota ?? { ...defaultQuotaPolicy },
      circuitBreaker: policy.circuitBreaker ?? { ...defaultCircuitPolicy },
    };
  }

  async persistPolicy(name: string): Promise<void> {
    const metrics = this.ensureMetrics(name);
    const circuit = metrics.policy.circuitBreaker ?? defaultCircuitPolicy;
    const quota = metrics.policy.quota ?? defaultQuotaPolicy;
    const payload: McpPolicyRecord = {
      name,
      quotaLimitPerMinute: quota.limitPerMinute ?? null,
      quotaBurstMultiplier: quota.burstMultiplier ?? null,
      circuitFailureThreshold: circuit.failureThreshold ?? null,
      circuitCooldownSeconds: circuit.cooldownSeconds ?? null,
      circuitMinimumSamples: circuit.minimumSamples ?? null,
    };
    await savePolicyToStorage(payload);
  }

  beforeCall(name: string): void {
    const metrics = this.ensureMetrics(name);
    const now = Date.now();
    if (metrics.circuitOpenUntil && metrics.circuitOpenUntil > now) {
      throw Object.assign(new Error('MCP 服务已触发熔断，请稍后重试'), {
        code: 'circuit_open',
      });
    }
    if (metrics.circuitOpenUntil && metrics.circuitOpenUntil <= now) {
      metrics.circuitOpenUntil = undefined;
      metrics.consecutiveFailures = 0;
    }

    const limit = metrics.policy.quota?.limitPerMinute;
    const burst = metrics.policy.quota?.burstMultiplier ?? defaultQuotaPolicy.burstMultiplier ?? 1.2;
    if (limit && limit > 0) {
      this.pruneQuotaWindow(metrics, now);
      const allowance = Math.ceil(limit * burst);
      if (metrics.quotaWindow.length >= allowance) {
        throw Object.assign(new Error('MCP 服务已超过配置的速率配额'), {
          code: 'quota_exceeded',
        });
      }
    }
  }

  observeCall(name: string, sample: Omit<CallSample, 'timestamp'> & { timestamp?: number }): void {
    const metrics = this.ensureMetrics(name);
    const timestamp = sample.timestamp ?? Date.now();
    metrics.calls.push({
      timestamp,
      durationMs: sample.durationMs,
      success: sample.success,
      errorMessage: sample.errorMessage,
    });
    if (metrics.calls.length > MAX_SAMPLES) {
      metrics.calls.splice(0, metrics.calls.length - MAX_SAMPLES);
    }

    this.pruneQuotaWindow(metrics, timestamp);
    metrics.quotaWindow.push(timestamp);

    if (metrics.quotaWindow.length > MAX_SAMPLES) {
      metrics.quotaWindow.splice(0, metrics.quotaWindow.length - MAX_SAMPLES);
    }

    if (sample.success) {
      metrics.lastSuccessAt = timestamp;
      metrics.consecutiveFailures = 0;
    } else {
      metrics.lastErrorAt = timestamp;
      metrics.lastErrorMessage = sample.errorMessage;
      metrics.consecutiveFailures += 1;
      this.tryOpenCircuit(name, metrics);
    }
  }

  recordManualCheck(name: string, result: ManualCheck): void {
    const metrics = this.ensureMetrics(name);
    metrics.lastManualCheck = result;
    if (result.status === 'healthy') {
      metrics.lastSuccessAt = result.checkedAt;
    }
    if (result.status === 'unreachable') {
      metrics.lastErrorAt = result.checkedAt;
      metrics.lastErrorMessage = result.message;
    }
  }

  getStatus(name: string): ServiceStatus {
    const metrics = this.ensureMetrics(name);
    return this.composeStatus(name, metrics);
  }

  listStatuses(): ServiceStatus[] {
    return Array.from(this.metrics.entries())
      .map(([name, metric]) => this.composeStatus(name, metric))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private ensureMetrics(name: string): ServiceMetrics {
    const metrics = this.metrics.get(name);
    if (metrics) return metrics;
    const fresh: ServiceMetrics = {
      policy: this.composePolicy(),
      calls: [],
      quotaWindow: [],
      consecutiveFailures: 0,
    };
    this.metrics.set(name, fresh);
    return fresh;
  }

  private composePolicy(raw?: McpPolicyRecord): ServicePolicy {
    const quota: QuotaPolicy | undefined =
      raw && (raw.quotaLimitPerMinute != null || raw.quotaBurstMultiplier != null)
        ? {
            limitPerMinute: raw.quotaLimitPerMinute ?? undefined,
            burstMultiplier: raw.quotaBurstMultiplier ?? defaultQuotaPolicy.burstMultiplier,
          }
        : undefined;

    const circuit: CircuitBreakerPolicy | undefined =
      raw &&
      (raw.circuitFailureThreshold != null || raw.circuitCooldownSeconds != null || raw.circuitMinimumSamples != null)
        ? {
            failureThreshold: raw.circuitFailureThreshold ?? defaultCircuitPolicy.failureThreshold,
            cooldownSeconds: raw.circuitCooldownSeconds ?? defaultCircuitPolicy.cooldownSeconds,
            minimumSamples: raw.circuitMinimumSamples ?? defaultCircuitPolicy.minimumSamples,
          }
        : undefined;

    return {
      quota: quota ?? { ...defaultQuotaPolicy },
      circuitBreaker: circuit ?? { ...defaultCircuitPolicy },
    };
  }

  private pruneQuotaWindow(metrics: ServiceMetrics, now: number): void {
    const windowStart = now - 60_000;
    while (metrics.quotaWindow.length > 0 && metrics.quotaWindow[0] < windowStart) {
      metrics.quotaWindow.shift();
    }
  }

  private tryOpenCircuit(name: string, metrics: ServiceMetrics): void {
    const policy = metrics.policy.circuitBreaker ?? defaultCircuitPolicy;
    const sampleCount = metrics.calls.length;
    if (sampleCount < (policy.minimumSamples ?? defaultCircuitPolicy.minimumSamples ?? 5)) {
      return;
    }

    if (metrics.consecutiveFailures >= policy.failureThreshold) {
      metrics.circuitOpenUntil = Date.now() + policy.cooldownSeconds * 1000;
      metrics.lastManualCheck = {
        status: 'unreachable',
        checkedAt: Date.now(),
        message: '连续失败达到熔断阈值',
      };
    }
  }

  private composeStatus(name: string, metrics: ServiceMetrics): ServiceStatus {
    const samples = metrics.calls.slice(-50);
    const totalCalls = samples.length;
    const failureCount = samples.filter((item) => !item.success).length;
    const successCount = samples.filter((item) => item.success).length;
    const errorRate = totalCalls === 0 ? 0 : failureCount / totalCalls;
    const latencies = samples.filter((item) => item.success).map((item) => item.durationMs).sort((a, b) => a - b);

    const p50Latency = latencies.length ? latencies[Math.floor(latencies.length * 0.5)] : undefined;
    const p95Latency = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : undefined;

    const quotaLimit = metrics.policy.quota?.limitPerMinute;
    const burstMultiplier = metrics.policy.quota?.burstMultiplier ?? defaultQuotaPolicy.burstMultiplier ?? 1.2;
    const now = Date.now();
    this.pruneQuotaWindow(metrics, now);

    const circuitOpen = metrics.circuitOpenUntil != null && metrics.circuitOpenUntil > now;

    let health: HealthState = 'healthy';
    let message: string | undefined;

    if (circuitOpen) {
      health = 'unreachable';
      message = metrics.lastManualCheck?.message ?? '服务处于熔断状态';
    } else if (errorRate > 0.3 || metrics.consecutiveFailures >= 2) {
      health = 'degraded';
      message = metrics.lastErrorMessage ?? '近期调用失败率偏高';
    }

    const status: ServiceStatus = {
      name,
      health,
      message,
      lastSuccessAt: metrics.lastSuccessAt ? new Date(metrics.lastSuccessAt).toISOString() : undefined,
      lastErrorAt: metrics.lastErrorAt ? new Date(metrics.lastErrorAt).toISOString() : undefined,
      lastCheckedAt: metrics.calls.length
        ? new Date(metrics.calls[metrics.calls.length - 1].timestamp).toISOString()
        : undefined,
      lastManualCheck: metrics.lastManualCheck
        ? {
            status: metrics.lastManualCheck.status,
            latencyMs: metrics.lastManualCheck.latencyMs,
            message: metrics.lastManualCheck.message,
            checkedAt: new Date(metrics.lastManualCheck.checkedAt).toISOString(),
          }
        : undefined,
      metrics: {
        totalCalls,
        successCount,
        failureCount,
        errorRate,
        p50Latency,
        p95Latency,
        consecutiveFailures: metrics.consecutiveFailures,
      },
      policy: metrics.policy,
      quota: {
        limitPerMinute: quotaLimit,
        currentUsage: metrics.quotaWindow.length,
        burstMultiplier,
      },
      circuit: {
        open: circuitOpen,
        releaseAt: metrics.circuitOpenUntil ? new Date(metrics.circuitOpenUntil).toISOString() : undefined,
      },
    };

    return status;
  }

  private async probeEndpoint(url: string, timeoutMs: number): Promise<ManualCheck> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      });
      const latency = Date.now() - started;
      if (response.ok) {
        return {
          status: 'healthy',
          checkedAt: Date.now(),
          latencyMs: latency,
        };
      }
      return {
        status: 'degraded',
        checkedAt: Date.now(),
        latencyMs: latency,
        message: `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        status: 'unreachable',
        checkedAt: Date.now(),
        message: error instanceof Error ? error.message : '无法访问服务',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async runHealthCheck(service: McpServerConfig): Promise<ManualCheck> {
    const endpoint = new URL(service.baseUrl);
    const probe = await this.probeEndpoint(endpoint.toString(), Math.min(service.timeoutMs ?? 30_000, 10_000));
    this.recordManualCheck(service.name, probe);
    if (probe.status === 'healthy') {
      this.ensureMetrics(service.name).consecutiveFailures = 0;
    }
    return probe;
  }
}

export const mcpMonitor = new McpServiceMonitor();
