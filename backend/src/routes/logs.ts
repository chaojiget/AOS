import { Router } from 'express';
import { getTelemetryExporter } from '../telemetry/provider';
import {
  TelemetryInitializationError,
  TelemetryStorageError,
} from '../telemetry/nats-exporter';
import { requireAuth, getAuthContext } from '../auth/middleware';

const router = Router();
const telemetryExporter = getTelemetryExporter();

const handleTelemetryError = (res: any, error: unknown, traceId?: string) => {
  if (error instanceof TelemetryInitializationError) {
    console.error('[Logs] NATS JetStream 未就绪:', error);
    res.status(503).json({
      error: '日志服务暂不可用',
      traceId,
    });
    return true;
  }

  if (error instanceof TelemetryStorageError) {
    console.error('[Logs] 写入 NATS JetStream 失败:', error);
    res.status(500).json({
      error: '日志服务写入失败',
      traceId,
    });
    return true;
  }

  return false;
};

router.post('/', requireAuth('mcp.logs.write'), async (req, res) => {
  const traceId = res.locals.traceId;
  const { level = 'info', message, traceId: payloadTraceId, spanId, attributes } = req.body as Record<string, any>;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({
      error: 'message 必须为字符串',
      traceId,
    });
  }

  try {
    await telemetryExporter.ensureReady();
    await telemetryExporter.logEvent(level, message, payloadTraceId, spanId, attributes);

    const auth = getAuthContext(req);
    if (auth) {
      console.info('[Logs] 新增日志', {
        actor: auth.subject,
        level,
        hasTrace: Boolean(payloadTraceId),
      });
    }

    res.status(202).json({
      status: 'accepted',
      level,
      traceId: payloadTraceId,
    });
  } catch (error) {
    if (handleTelemetryError(res, error, traceId)) {
      return;
    }
    console.error('[Logs] 写入失败:', error);
    res.status(500).json({
      error: '写入日志失败',
      traceId,
    });
  }
});

router.get('/', requireAuth('mcp.logs.read'), async (req, res) => {
  const traceId = res.locals.traceId;

  try {
    await telemetryExporter.ensureReady();

    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const level = req.query.level ? String(req.query.level) : undefined;
    const after = req.query.after ? Number(req.query.after) : undefined;
    const targetTraceId = req.query.traceId ? String(req.query.traceId) : undefined;

    const logs = await telemetryExporter.getLogs(limit, {
      level,
      after,
      traceId: targetTraceId,
    });

    res.json({
      logs,
      count: logs.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (handleTelemetryError(res, error, traceId)) {
      return;
    }

    console.error('[Logs] 查询失败:', error);
    res.status(500).json({
      error: '查询日志失败',
      traceId,
    });
  }
});

router.get('/stream', requireAuth('mcp.logs.subscribe'), async (req, res) => {
  const traceId = res.locals.traceId;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;

  try {
    const subscription = await telemetryExporter.createLogSubscription();

    req.on('close', async () => {
      if (closed) return;
      closed = true;
      await subscription.close();
    });

    req.on('end', async () => {
      if (closed) return;
      closed = true;
      await subscription.close();
    });

    for await (const log of subscription.iterator) {
      if (closed) {
        break;
      }
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    }
  } catch (error) {
    if (!closed) {
      if (!handleTelemetryError(res, error, traceId)) {
        console.error('[Logs] 推送失败:', error);
        res.write(`event: error\ndata: ${JSON.stringify({ error: '订阅失败', traceId })}\n\n`);
      }
      res.end();
    }
    closed = true;
  }
});

export { router as logRoutes };
