import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { ExportResult, ExportResultCode } from '@opentelemetry/core';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface JsonExporterOptions {
  dataPath: string;
}

interface TraceEntry {
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

interface LogEntry {
  id: string;
  timestamp: number;
  level: string;
  message: string;
  trace_id?: string;
  span_id?: string;
  attributes?: any;
  created_at: number;
}

interface MetricEntry {
  id: string;
  name: string;
  value: number;
  unit?: string;
  timestamp: number;
  attributes?: any;
  created_at: number;
}

export class JsonTraceExporter implements SpanExporter {
  private dataPath: string;
  private tracesFile: string;
  private logsFile: string;
  private metricsFile: string;

  constructor(options: JsonExporterOptions) {
    this.dataPath = options.dataPath;
    this.tracesFile = path.join(this.dataPath, 'traces.json');
    this.logsFile = path.join(this.dataPath, 'logs.json');
    this.metricsFile = path.join(this.dataPath, 'metrics.json');
    this.initializeStorage();
  }

  private async initializeStorage(): Promise<void> {
    try {
      await fs.mkdir(this.dataPath, { recursive: true });

      // Initialize files if they don't exist
      for (const file of [this.tracesFile, this.logsFile, this.metricsFile]) {
        try {
          await fs.access(file);
        } catch {
          await fs.writeFile(file, '[]');
        }
      }
    } catch (error) {
      console.error('Failed to initialize storage:', error);
    }
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.exportSpans(spans)
      .then(() => resultCallback({ code: ExportResultCode.SUCCESS }))
      .catch((error) => {
        console.error('Error exporting spans:', error);
        resultCallback({ code: ExportResultCode.FAILED });
      });
  }

  private async exportSpans(spans: ReadableSpan[]): Promise<void> {
    const traces = await this.readJsonFile<TraceEntry[]>(this.tracesFile);

    for (const span of spans) {
      const traceId = span.spanContext().traceId;
      const spanId = span.spanContext().spanId;
      const parentSpanId = span.parentSpanId || undefined;
      const operationName = span.name;
      const startTime = span.startTime[0] * 1000 + Math.floor(span.startTime[1] / 1000000);
      const endTime = span.endTime[0] * 1000 + Math.floor(span.endTime[1] / 1000000);
      const duration = endTime - startTime;
      const status = span.status.code.toString();

      const traceEntry: TraceEntry = {
        id: uuidv4(),
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: parentSpanId,
        operation_name: operationName,
        start_time: startTime,
        end_time: endTime,
        duration,
        status,
        attributes: span.attributes,
        events: span.events,
        created_at: Date.now(),
      };

      traces.push(traceEntry);
    }

    // Keep only the last 1000 traces
    if (traces.length > 1000) {
      traces.splice(0, traces.length - 1000);
    }

    await this.writeJsonFile(this.tracesFile, traces);
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  // Additional methods for querying telemetry data
  async getTraces(limit: number = 100): Promise<TraceEntry[]> {
    const traces = await this.readJsonFile<TraceEntry[]>(this.tracesFile);
    return traces
      .sort((a, b) => b.start_time - a.start_time)
      .slice(0, limit);
  }

  async getTraceById(traceId: string): Promise<TraceEntry[]> {
    const traces = await this.readJsonFile<TraceEntry[]>(this.tracesFile);
    return traces
      .filter(t => t.trace_id === traceId)
      .sort((a, b) => a.start_time - b.start_time);
  }

  async getLogs(limit: number = 100): Promise<LogEntry[]> {
    const logs = await this.readJsonFile<LogEntry[]>(this.logsFile);
    return logs
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  async getMetrics(limit: number = 100): Promise<MetricEntry[]> {
    const metrics = await this.readJsonFile<MetricEntry[]>(this.metricsFile);
    return metrics
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // Method to log custom events
  async logEvent(level: string, message: string, traceId?: string, spanId?: string, attributes?: any): Promise<void> {
    const logs = await this.readJsonFile<LogEntry[]>(this.logsFile);

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

    logs.push(logEntry);

    // Keep only the last 1000 logs
    if (logs.length > 1000) {
      logs.splice(0, logs.length - 1000);
    }

    await this.writeJsonFile(this.logsFile, logs);
  }

  // Method to record custom metrics
  async recordMetric(name: string, value: number, unit?: string, attributes?: any): Promise<void> {
    const metrics = await this.readJsonFile<MetricEntry[]>(this.metricsFile);

    const metricEntry: MetricEntry = {
      id: uuidv4(),
      name,
      value,
      unit,
      timestamp: Date.now(),
      attributes,
      created_at: Date.now(),
    };

    metrics.push(metricEntry);

    // Keep only the last 1000 metrics
    if (metrics.length > 1000) {
      metrics.splice(0, metrics.length - 1000);
    }

    await this.writeJsonFile(this.metricsFile, metrics);
  }

  private async readJsonFile<T>(filePath: string): Promise<T> {
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as T;
    } catch (error) {
      console.error(`Error reading ${filePath}:`, error);
      return [] as unknown as T;
    }
  }

  private async writeJsonFile<T>(filePath: string, data: T): Promise<void> {
    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`Error writing ${filePath}:`, error);
      throw error;
    }
  }
}
