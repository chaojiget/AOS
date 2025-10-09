import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { ExportResult, ExportResultCode } from '@opentelemetry/core';
import { v4 as uuidv4 } from 'uuid';
import {
  connect,
  JSONCodec,
  ErrorCode,
  type ConnectionOptions,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
  NatsError,
  RetentionPolicy,
  DiscardPolicy,
  StorageType,
  type Stream,
  type Subscription,
} from 'nats';

export interface NatsTelemetryOptions {
  subjectPrefix?: string;
  streamPrefix?: string;
  maxMessages?: number;
  servers?: string | string[];
  connectionName?: string;
  user?: string;
  pass?: string;
  token?: string;
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

type TelemetryType = 'traces' | 'logs' | 'metrics';

type NatsHandles = {
  connection: NatsConnection;
  jetStream: JetStreamClient;
  manager: JetStreamManager;
};

export class NatsTelemetryExporter implements SpanExporter {
  private static connectionPromise: Promise<NatsConnection> | null = null;
  private static jetStream: JetStreamClient | null = null;
  private static manager: JetStreamManager | null = null;
  private static resolvedOptions: ConnectionOptions | null = null;

  private readonly jsonCodec = JSONCodec();
  private readonly subjects: Record<TelemetryType, string>;
  private readonly streams: Record<TelemetryType, string>;
  private readonly maxMessages: number;
  private readonly connectionOptions: ConnectionOptions;
  private readonly initPromise: Promise<void>;
  private initError: TelemetryInitializationError | null = null;

  constructor(options?: NatsTelemetryOptions) {
    this.connectionOptions = this.buildConnectionOptions(options);

    const subjectPrefix = options?.subjectPrefix
      ?? process.env.NATS_TELEMETRY_SUBJECT_PREFIX
      ?? 'telemetry';

    const streamPrefix = options?.streamPrefix
      ?? process.env.NATS_TELEMETRY_STREAM_PREFIX
      ?? 'AOS_TELEMETRY';

    const maxMessagesFromEnv = process.env.NATS_TELEMETRY_MAX_MESSAGES
      ? Number(process.env.NATS_TELEMETRY_MAX_MESSAGES)
      : undefined;

    this.maxMessages = options?.maxMessages
      ?? maxMessagesFromEnv
      ?? 1000;

    this.subjects = {
      traces: `${subjectPrefix}.traces`,
      logs: `${subjectPrefix}.logs`,
      metrics: `${subjectPrefix}.metrics`,
    };

    this.streams = {
      traces: `${streamPrefix}_TRACES`,
      logs: `${streamPrefix}_LOGS`,
      metrics: `${streamPrefix}_METRICS`,
    };

    this.initPromise = this.initialize().catch((error: unknown) => {
      const initError = new TelemetryInitializationError('NATS JetStream 初始化失败', { cause: error });
      this.initError = initError;
      throw initError;
    });
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.exportSpans(spans)
      .then(() => resultCallback({ code: ExportResultCode.SUCCESS }))
      .catch((error) => {
        console.error('导出 Trace 至 NATS JetStream 失败:', error);
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

    const fetchLimit = filters?.traceId ? this.maxMessages : limit;
    const records = await this.fetchMessages<TraceEntry>('traces', fetchLimit);
    let traces = records.sort((a, b) => b.start_time - a.start_time);

    if (filters?.traceId) {
      traces = traces.filter(trace => trace.trace_id === filters.traceId);
    }

    return traces.slice(0, limit);
  }

  async getTraceById(traceId: string, limit: number = this.maxMessages): Promise<TraceEntry[]> {
    const traces = await this.getTraces(limit, { traceId });
    return traces.sort((a, b) => a.start_time - b.start_time);
  }

  async getLogs(limit: number = 100, filters?: { level?: string; traceId?: string; after?: number; before?: number; topic?: string }): Promise<LogEntry[]> {
    await this.ensureReady();
    const fetchLimit = filters?.level ? this.maxMessages : limit;
    let logs = await this.fetchMessages<LogEntry>('logs', fetchLimit);

    if (filters?.level) {
      logs = logs.filter(log => log.level === filters.level);
    }

    if (filters?.traceId) {
      logs = logs.filter(log => log.trace_id === filters.traceId);
    }

    if (filters?.after) {
      logs = logs.filter(log => log.timestamp > filters.after!);
    }

     if (filters?.before) {
      logs = logs.filter(log => log.timestamp < filters.before!);
    }

    if (filters?.topic) {
      logs = logs.filter((log) => {
        const topic = (log.attributes as any)?.topic;
        return typeof topic === 'string' && topic.includes(filters.topic!);
      });
    }

    return logs
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  async createLogSubscription(): Promise<{ iterator: AsyncIterable<LogEntry>; close: () => Promise<void> }> {
    await this.ensureReady();
    const { connection } = await this.getNatsHandles();
    const subject = this.subjects.logs;
    const subscription = connection.subscribe(subject, { queue: undefined });

    const iterator = this.buildLogIterator(subscription);

    const close = async () => {
      try {
        if ('drain' in subscription && typeof subscription.drain === 'function') {
          await subscription.drain();
        } else {
          subscription.unsubscribe();
        }
      } catch (error) {
        console.error('[Telemetry] 关闭日志订阅失败', error);
      }
    };

    return { iterator, close };
  }

  async getMetrics(limit: number = 100, filters?: { name?: string }): Promise<MetricEntry[]> {
    await this.ensureReady();
    const fetchLimit = filters?.name ? this.maxMessages : limit;
    let metrics = await this.fetchMessages<MetricEntry>('metrics', fetchLimit);

    if (filters?.name) {
      metrics = metrics.filter(metric => metric.name === filters.name);
    }

    return metrics
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  private buildConnectionOptions(options?: NatsTelemetryOptions): ConnectionOptions {
    const serversFromOptions = options?.servers ?? process.env.NATS_URL ?? 'nats://localhost:4222';
    const parsedServers = Array.isArray(serversFromOptions)
      ? serversFromOptions
      : String(serversFromOptions)
        .split(',')
        .map(server => server.trim())
        .filter(Boolean);

    const connectionOptions: ConnectionOptions = {
      servers: parsedServers.length === 1 ? parsedServers[0] : parsedServers,
      name: options?.connectionName ?? process.env.NATS_CONNECTION_NAME ?? 'aos-telemetry-exporter',
    };

    const user = options?.user ?? process.env.NATS_USER;
    const pass = options?.pass ?? process.env.NATS_PASS;
    const token = options?.token ?? process.env.NATS_TOKEN;

    if (token) {
      connectionOptions.token = token;
    } else if (user && pass) {
      connectionOptions.user = user;
      connectionOptions.pass = pass;
    }

    return connectionOptions;
  }

  private async initialize(): Promise<void> {
    const handles = await this.getNatsHandles();

    await Promise.all([
      this.ensureStream(handles.manager, 'traces'),
      this.ensureStream(handles.manager, 'logs'),
      this.ensureStream(handles.manager, 'metrics'),
    ]);
  }

  private async exportSpans(spans: ReadableSpan[]): Promise<void> {
    if (spans.length === 0) {
      return;
    }

    await this.ensureReady();

    for (const span of spans) {
      const traceEntry = this.mapSpanToTrace(span);
      await this.sendMessage('traces', traceEntry);
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

  private async enqueue(type: TelemetryType, payload: TraceEntry | LogEntry | MetricEntry): Promise<void> {
    await this.ensureReady();
    await this.sendMessage(type, payload);
  }

  private async sendMessage(type: TelemetryType, payload: TraceEntry | LogEntry | MetricEntry): Promise<void> {
    try {
      const { jetStream } = await this.getNatsHandles();
      const subject = this.subjects[type];
      await jetStream.publish(subject, this.jsonCodec.encode(payload));
    } catch (error: unknown) {
      throw new TelemetryStorageError('写入 NATS JetStream 失败', { cause: error });
    }
  }

  private async fetchMessages<T>(type: TelemetryType, limit: number): Promise<T[]> {
    try {
      const stream = await this.getStream(type);
      const info = await stream.info(true);

      if (info.state.messages === 0) {
        return [];
      }

      const subject = this.subjects[type];
      const result: T[] = [];
      let sequence = info.state.last_seq;

      while (sequence > 0 && result.length < limit) {
        try {
          const storedMsg = await stream.getMessage({ seq: sequence });
          if (storedMsg.subject === subject) {
            const payload = this.jsonCodec.decode(storedMsg.data) as T;
            result.push(payload);
          }
        } catch (error: unknown) {
          if (this.isNatsError(error) && error.code === ErrorCode.JetStream404NoMessages) {
            // 消息已被丢弃，跳过该序列
          } else {
            throw error;
          }
        }
        sequence -= 1;
      }

      return result;
    } catch (error: unknown) {
      throw new TelemetryStorageError('读取 NATS JetStream 消息失败', { cause: error });
    }
  }

  private buildLogIterator(subscription: Subscription): AsyncIterable<LogEntry> {
    const { jsonCodec } = this;

    const asyncGenerator = async function* (): AsyncIterable<LogEntry> {
      for await (const message of subscription) {
        try {
          const decoded = jsonCodec.decode(message.data) as LogEntry;
          yield decoded;
        } catch (error) {
          console.error('[Telemetry] 解码日志消息失败', error);
        }
      }
    };

    return asyncGenerator();
  }

  private async getStream(type: TelemetryType): Promise<Stream> {
    const { manager } = await this.getNatsHandles();
    return manager.streams.get(this.streams[type]);
  }

  private async ensureStream(manager: JetStreamManager, type: TelemetryType): Promise<void> {
    const streamName = this.streams[type];
    const subject = this.subjects[type];

    const config = {
      name: streamName,
      subjects: [subject],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      discard: DiscardPolicy.Old,
      allow_direct: true,
      num_replicas: 1,
      max_msgs: this.maxMessages > 0 ? this.maxMessages : -1,
      max_msgs_per_subject: this.maxMessages > 0 ? this.maxMessages : -1,
    };

    try {
      await manager.streams.info(streamName);
      await manager.streams.update(streamName, {
        subjects: [subject],
        max_msgs: config.max_msgs,
        max_msgs_per_subject: config.max_msgs_per_subject,
        discard: config.discard,
        allow_direct: config.allow_direct,
      });
    } catch (error: unknown) {
      if (this.isStreamNotFound(error)) {
        await manager.streams.add({
          ...config,
          description: `Telemetry stream for ${type}`,
        });
        return;
      }

      throw error;
    }
  }

  private isStreamNotFound(error: unknown): boolean {
    return this.isNatsError(error) && error.code === ErrorCode.JetStream404NoMessages;
  }

  private isNatsError(error: unknown): error is NatsError {
    return error instanceof NatsError;
  }

  private async getNatsHandles(): Promise<NatsHandles> {
    if (!NatsTelemetryExporter.connectionPromise) {
      NatsTelemetryExporter.resolvedOptions = this.connectionOptions;
      NatsTelemetryExporter.connectionPromise = connect(this.connectionOptions)
        .catch((error) => {
          NatsTelemetryExporter.connectionPromise = null;
          NatsTelemetryExporter.jetStream = null;
          NatsTelemetryExporter.manager = null;
          NatsTelemetryExporter.resolvedOptions = null;
          throw error;
        });
    }

    const connection = await NatsTelemetryExporter.connectionPromise;

    if (!NatsTelemetryExporter.jetStream) {
      NatsTelemetryExporter.jetStream = connection.jetstream();
    }

    if (!NatsTelemetryExporter.manager) {
      NatsTelemetryExporter.manager = await connection.jetstreamManager();
    }

    return {
      connection,
      jetStream: NatsTelemetryExporter.jetStream,
      manager: NatsTelemetryExporter.manager,
    };
  }
}
