import { Router, type Response } from 'express';
import {
  NatsTelemetryExporter,
  TelemetryInitializationError,
  TelemetryStorageError,
} from '../telemetry/nats-exporter';

const router = Router();
const telemetryExporter = new NatsTelemetryExporter({ maxMessages: 1000 });

const handleTelemetryError = (res: Response, error: unknown, traceId?: string) => {
  if (error instanceof TelemetryInitializationError) {
    console.error('NATS JetStream 不可用，无法写入遥测数据:', error);
    res.status(500).json({
      error: '遥测队列未初始化，服务暂不可用',
      traceId,
    });
    return true;
  }

  if (error instanceof TelemetryStorageError) {
    console.error('NATS JetStream 遥测入队失败:', error);
    res.status(500).json({
      error: '遥测服务异常，请稍后重试',
      traceId,
    });
    return true;
  }

  return false;
};

router.get('/traces', async (req, res) => {
  const traceId = res.locals.traceId;

  try {
    await telemetryExporter.ensureReady();

    const limit = parseInt(req.query.limit as string) || 50;
    const traces = await telemetryExporter.getTraces(limit);

    res.json({
      traces,
      count: traces.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (handleTelemetryError(res, error, traceId)) {
      return;
    }

    console.error('获取追踪数据失败:', error);
    res.status(500).json({
      error: 'Failed to fetch traces',
      traceId,
    });
  }
});

router.get('/traces/:traceId', async (req, res) => {
  const { traceId: targetTraceId } = req.params;
  const traceId = res.locals.traceId;

  try {
    await telemetryExporter.ensureReady();

    const trace = await telemetryExporter.getTraceById(targetTraceId);

    if (!trace || trace.length === 0) {
      return res.status(404).json({
        error: 'Trace not found',
        traceId,
      });
    }

    res.json({
      trace,
      traceId: targetTraceId,
      spans: trace.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (handleTelemetryError(res, error, traceId)) {
      return;
    }

    console.error('获取指定 Trace 失败:', error);
    res.status(500).json({
      error: 'Failed to fetch trace',
      traceId,
    });
  }
});

router.get('/logs', async (req, res) => {
  const traceId = res.locals.traceId;

  try {
    await telemetryExporter.ensureReady();

    const limit = parseInt(req.query.limit as string) || 100;
    const level = req.query.level as string | undefined;

    const logs = await telemetryExporter.getLogs(limit, { level });

    res.json({
      logs,
      count: logs.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (handleTelemetryError(res, error, traceId)) {
      return;
    }

    console.error('获取日志失败:', error);
    res.status(500).json({
      error: 'Failed to fetch logs',
      traceId,
    });
  }
});

router.get('/metrics', async (req, res) => {
  const traceId = res.locals.traceId;

  try {
    await telemetryExporter.ensureReady();

    const limit = parseInt(req.query.limit as string) || 100;
    const name = req.query.name as string | undefined;

    const metrics = await telemetryExporter.getMetrics(limit, { name });

    res.json({
      metrics,
      count: metrics.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (handleTelemetryError(res, error, traceId)) {
      return;
    }

    console.error('获取指标失败:', error);
    res.status(500).json({
      error: 'Failed to fetch metrics',
      traceId,
    });
  }
});

router.get('/stats', async (req, res) => {
  const traceId = res.locals.traceId;

  try {
    await telemetryExporter.ensureReady();

    const traces = await telemetryExporter.getTraces(1000);
    const logs = await telemetryExporter.getLogs(1000);
    const metrics = await telemetryExporter.getMetrics(1000);

    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    const recentTraces = traces.filter(t => t.start_time > oneHourAgo);
    const recentLogs = logs.filter(l => l.timestamp > oneHourAgo);
    const recentMetrics = metrics.filter(m => m.timestamp > oneHourAgo);

    const errorLogs = recentLogs.filter(l => l.level === 'error');
    const avgResponseTime = recentTraces.length > 0
      ? recentTraces.reduce((sum, t) => sum + (t.duration || 0), 0) / recentTraces.length
      : 0;

    const stats = {
      total: {
        traces: traces.length,
        logs: logs.length,
        metrics: metrics.length,
      },
      recent: {
        traces: recentTraces.length,
        logs: recentLogs.length,
        metrics: recentMetrics.length,
        errorLogs: errorLogs.length,
      },
      performance: {
        avgResponseTime: Math.round(avgResponseTime),
        totalErrors: errorLogs.length,
        errorRate: recentLogs.length > 0 ? (errorLogs.length / recentLogs.length) * 100 : 0,
      },
      timestamp: new Date().toISOString(),
    };

    res.json(stats);
  } catch (error) {
    if (handleTelemetryError(res, error, traceId)) {
      return;
    }

    console.error('获取遥测统计失败:', error);
    res.status(500).json({
      error: 'Failed to calculate telemetry stats',
      traceId,
    });
  }
});

router.post('/logs', async (req, res) => {
  const traceId = res.locals.traceId;

  try {
    await telemetryExporter.ensureReady();

    const { level, message, attributes } = req.body;

    if (!level || !message) {
      return res.status(400).json({
        error: 'Level and message are required',
        traceId,
      });
    }

    await telemetryExporter.logEvent(level, message, traceId, undefined, attributes);

    res.json({
      success: true,
      traceId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (handleTelemetryError(res, error, traceId)) {
      return;
    }

    console.error('写入日志失败:', error);
    res.status(500).json({
      error: 'Failed to add log entry',
      traceId,
    });
  }
});

export { router as telemetryRoutes };
