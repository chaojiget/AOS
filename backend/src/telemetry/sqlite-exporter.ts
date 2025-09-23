import { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-node';
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
    try {
      const insertTrace = this.db.prepare(`
        INSERT INTO traces (
          id, trace_id, span_id, parent_span_id, operation_name,
          start_time, end_time, duration, status, attributes, events
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const span of spans) {
        const traceId = span.spanContext().traceId;
        const spanId = span.spanContext().spanId;
        const parentSpanId = span.parentSpanId || null;
        const operationName = span.name;
        const startTime = span.startTime[0] * 1000 + Math.floor(span.startTime[1] / 1000000);
        const endTime = span.endTime[0] * 1000 + Math.floor(span.endTime[1] / 1000000);
        const duration = endTime - startTime;
        const status = span.status.code.toString();
        const attributes = JSON.stringify(span.attributes);
        const events = JSON.stringify(span.events);

        insertTrace.run(
          uuidv4(),
          traceId,
          spanId,
          parentSpanId,
          operationName,
          startTime,
          endTime,
          duration,
          status,
          attributes,
          events
        );
      }

      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (error) {
      console.error('Error exporting traces to SQLite:', error);
      resultCallback({ code: ExportResultCode.FAILED });
    }
  }

  shutdown(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }

  // Additional methods for querying telemetry data
  getTraces(limit: number = 100): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM traces
      ORDER BY start_time DESC
      LIMIT ?
    `);
    return stmt.all(limit);
  }

  getTraceById(traceId: string): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM traces
      WHERE trace_id = ?
      ORDER BY start_time ASC
    `);
    return stmt.all(traceId);
  }

  getLogs(limit: number = 100): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM logs
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    return stmt.all(limit);
  }

  getMetrics(limit: number = 100): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM metrics
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    return stmt.all(limit);
  }

  // Method to log custom events
  logEvent(level: string, message: string, traceId?: string, spanId?: string, attributes?: any): void {
    const stmt = this.db.prepare(`
      INSERT INTO logs (id, timestamp, level, message, trace_id, span_id, attributes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      uuidv4(),
      Date.now(),
      level,
      message,
      traceId || null,
      spanId || null,
      attributes ? JSON.stringify(attributes) : null
    );
  }

  // Method to record custom metrics
  recordMetric(name: string, value: number, unit?: string, attributes?: any): void {
    const stmt = this.db.prepare(`
      INSERT INTO metrics (id, name, value, unit, timestamp, attributes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      uuidv4(),
      name,
      value,
      unit || null,
      Date.now(),
      attributes ? JSON.stringify(attributes) : null
    );
  }
}