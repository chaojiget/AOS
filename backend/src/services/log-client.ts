import { getTelemetryExporter } from '../telemetry/provider';

interface LogPayload {
  level?: string;
  message: string;
  traceId?: string;
  spanId?: string;
  attributes?: Record<string, unknown>;
}

const DEFAULT_LEVEL = 'info';

const resolveEndpoint = (): string | null => {
  const base = process.env.LOG_SERVICE_URL
    || process.env.INTERNAL_LOG_SERVICE_URL
    || process.env.INTERNAL_BASE_URL
    || (process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:3001');
  if (!base) {
    return null;
  }
  return base.endsWith('/api/logs') ? base : `${base.replace(/\/$/, '')}/api/logs`;
};

const endpoint = resolveEndpoint();
const telemetryExporter = getTelemetryExporter();

export const logClient = {
  async write(payload: LogPayload) {
    const level = payload.level ?? DEFAULT_LEVEL;
    const token = process.env.INTERNAL_LOG_TOKEN || process.env.AOS_INTERNAL_TOKEN;

    if (endpoint) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            level,
            message: payload.message,
            traceId: payload.traceId,
            spanId: payload.spanId,
            attributes: payload.attributes,
          }),
        });
        if (!res.ok) {
          throw new Error(`Log service responded ${res.status}`);
        }
        return;
      } catch (error) {
        console.error('[LogClient] 调用 /api/logs 失败，回退到直接写入', error);
      }
    }

    try {
      await telemetryExporter.logEvent(level, payload.message, payload.traceId, payload.spanId, payload.attributes);
    } catch (error) {
      console.error('[LogClient] 写入 NATS 日志失败', error);
    }
  },
};
