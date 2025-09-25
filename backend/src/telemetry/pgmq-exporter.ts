import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { ExportResult, ExportResultCode } from '@opentelemetry/core';
import { v4 as uuidv4 } from 'uuid';
import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/postgres';

export interface PgmqTelemetryOptions {
  queuePrefix?: string;
  maxQueueLength?: number;
}

export interface TraceEntry {
  id: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  operation_name: string;
  start_time: number;
  end_time: number;
  duration: number;
  status: string;
  attributes: any;
  events: any;
  created_at: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  level: string;
  message: string;
  trace_id?: string;
  span_id?: string;
  attributes?: any;
  created_at: number;
}

export interface MetricEntry {
  id: string;
  name: string;
  value: number;
  unit?: string;
  timestamp: number;
  attributes?: any;
  created_at: number;
}

export class TelemetryInitializationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TelemetryInitializationError';
  }
}

export class TelemetryStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TelemetryStorageError';
  }
}

type QueueType = 'traces' | 'logs' | 'metrics';

export class PgmqTelemetryExporter implements SpanExporter {
  private readonly pool: Pool;
  private readonly queueNames: Record<QueueType, string>;
  private readonly maxQueueLength: number;
  private readonly initPromise: Promise<void>;
  private initError: TelemetryInitializationError | null = null;

  constructor(options?: PgmqTelemetryOptions) {
    this.pool = getPool();
    const prefix = options?.queuePrefix ? `${options.queuePrefix}_` : '';
    this.queueNames = {
      traces: `${prefix}otel_traces`,
      logs: `${prefix}otel_logs`,
      metrics: `${prefix}otel_metrics`,
    };
    this.maxQueueLength = options?.maxQueueLength ?? 1000;

    // 初始化时创建 PGMQ 队列，忽略已存在的错误
    this.initPromise = this.initializeQueues().catch((error: any) => {
      const initError = new TelemetryInitializationError('PGMQ 队列初始化失败', { cause: error });
      this.initError = initError;
      throw initError;
    });
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.exportSpans(spans)
      .then(() => resultCallback({ code: ExportResultCode.SUCCESS }))
      .catch((error) => {
        console.error('导出 Trace 到 PGMQ 失败:', error);
        resultCallback({ code: ExportResultCode.FAILED });
      });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  async ensureReady(): Promise<void> {
    if (this.initError) {
      throw this.initError;
    }
    await this.initPromise;
  }

  async logEvent(level: string, message: string, traceId?: string, spanId?: string, attributes?: any): Promise<void> {
    await this.ensureReady();
    const logEntry: LogEntry = {
      id: uuidv4(),
      timestamp: Date.now(),
      level,
      message,
      trace_id: traceId,
      span_id: spanId,
      attributes,
      created_at: Date.now(),
    };

    await this.enqueue('logs', logEntry);
  }

  async recordMetric(name: string, value: number, unit?: string, attributes?: any): Promise<void> {
    await this.ensureReady();
    const metricEntry: MetricEntry = {
      id: uuidv4(),
      name,
      value,
      unit,
      timestamp: Date.now(),
      attributes,
      created_at: Date.now(),
    };

    await this.enqueue('metrics', metricEntry);
  }

  async getTraces(limit: number = 100, filters?: { traceId?: string }): Promise<TraceEntry[]> {
    await this.ensureReady();
    const fetchLimit = filters?.traceId ? this.maxQueueLength : limit;
    const records = await this.fetchQueue<TraceEntry>('traces', fetchLimit);
    let traces = records.sort((a, b) => b.start_time - a.start_time);

    if (filters?.traceId) {
      traces = traces.filter(trace => trace.trace_id === filters.traceId);
    }

    return traces.slice(0, limit);
  }

  async getTraceById(traceId: string, limit: number = this.maxQueueLength): Promise<TraceEntry[]> {
    const traces = await this.getTraces(limit, { traceId });
    return traces.sort((a, b) => a.start_time - b.start_time);
  }

  async getLogs(limit: number = 100, filters?: { level?: string }): Promise<LogEntry[]> {
    await this.ensureReady();
    const fetchLimit = filters?.level ? this.maxQueueLength : limit;
    let logs = await this.fetchQueue<LogEntry>('logs', fetchLimit);

    if (filters?.level) {
      logs = logs.filter(log => log.level === filters.level);
    }

    return logs
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  async getMetrics(limit: number = 100, filters?: { name?: string }): Promise<MetricEntry[]> {
    await this.ensureReady();
    const fetchLimit = filters?.name ? this.maxQueueLength : limit;
    let metrics = await this.fetchQueue<MetricEntry>('metrics', fetchLimit);

    if (filters?.name) {
      metrics = metrics.filter(metric => metric.name === filters.name);
    }

    return metrics
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  private async exportSpans(spans: ReadableSpan[]): Promise<void> {
    if (spans.length === 0) {
      return;
    }

    await this.ensureReady();
    const client = await this.pool.connect();

    try {
      for (const span of spans) {
        const traceEntry = this.mapSpanToTrace(span);
        await this.sendMessage(client, this.queueNames.traces, traceEntry);
      }
    } catch (error: any) {
      throw new TelemetryStorageError('写入 Trace 到 PGMQ 失败', { cause: error });
    } finally {
      client.release();
    }
  }

  private async initializeQueues(): Promise<void> {
    const client = await this.pool.connect();

    try {
      for (const queueName of Object.values(this.queueNames)) {
        try {
          await client.query('SELECT pgmq.create_queue($1)', [queueName]);
        } catch (error: any) {
          if (error?.code === '42P07' || /already exists/i.test(error?.message ?? '')) {
            continue;
          }
          throw error;
        }
      }
    } finally {
      client.release();
    }
  }

  private mapSpanToTrace(span: ReadableSpan): TraceEntry {
    const traceId = span.spanContext().traceId;
    const spanId = span.spanContext().spanId;
    const parentSpanId = span.parentSpanId || undefined;
    const startTime = span.startTime[0] * 1000 + Math.floor(span.startTime[1] / 1000000);
    const endTime = span.endTime[0] * 1000 + Math.floor(span.endTime[1] / 1000000);

    return {
      id: uuidv4(),
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: parentSpanId,
      operation_name: span.name,
      start_time: startTime,
      end_time: endTime,
      duration: endTime - startTime,
      status: span.status.code.toString(),
      attributes: span.attributes,
      events: span.events,
      created_at: Date.now(),
    };
  }

  private async enqueue(type: QueueType, payload: TraceEntry | LogEntry | MetricEntry): Promise<void> {
    await this.ensureReady();
    const client = await this.pool.connect();

    try {
      await this.sendMessage(client, this.queueNames[type], payload);
    } catch (error: any) {
      throw new TelemetryStorageError('写入 PGMQ 失败', { cause: error });
    } finally {
      client.release();
    }
  }

  private async sendMessage(client: PoolClient, queueName: string, payload: any): Promise<void> {
    await client.query('SELECT pgmq.send($1, $2::jsonb)', [queueName, JSON.stringify(payload)]);
    await this.enforceRetention(client, queueName).catch((error) => {
      console.warn(`PGMQ 队列 ${queueName} 清理失败:`, error);
    });
  }

  private async fetchQueue<T>(type: QueueType, limit: number): Promise<T[]> {
    const queueName = this.queueNames[type];
    const client = await this.pool.connect();

    try {
      const result = await client.query('SELECT msg FROM pgmq.peek($1, $2)', [queueName, limit]);
      return result.rows
        .map((row: any) => {
          const payload = row.msg;
          if (typeof payload === 'string') {
            return JSON.parse(payload) as T;
          }
          return payload as T;
        });
    } catch (error: any) {
      throw new TelemetryStorageError('读取 PGMQ 消息失败', { cause: error });
    } finally {
      client.release();
    }
  }

  private async enforceRetention(client: PoolClient, queueName: string): Promise<void> {
    if (!this.maxQueueLength) {
      return;
    }

    try {
      const lengthResult = await client.query('SELECT pgmq.length($1) AS length', [queueName]);
      const currentLength = Number(lengthResult.rows?.[0]?.length ?? 0);
      const excess = currentLength - this.maxQueueLength;

      if (excess > 0) {
        const readResult = await client.query('SELECT msg_id FROM pgmq.read($1, 0, $2)', [queueName, excess]);
        const messageIds = readResult.rows.map((row: any) => row.msg_id);

        if (messageIds.length > 0) {
          await client.query('SELECT pgmq.delete($1, $2)', [queueName, messageIds]);
        }
      }
    } catch (error: any) {
      throw new TelemetryStorageError(`PGMQ 队列 ${queueName} 保留策略执行失败`, { cause: error });
    }
  }
}
