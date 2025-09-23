import { Router } from 'express';
import { JsonTraceExporter } from '../telemetry/json-exporter';

const router = Router();
const telemetryExporter = new JsonTraceExporter({ dataPath: './telemetry-data' });

// GET /api/telemetry/traces - Get recent traces
router.get('/traces', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const traces = await telemetryExporter.getTraces(limit);

    res.json({
      traces,
      count: traces.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching traces:', error);
    res.status(500).json({
      error: 'Failed to fetch traces',
      traceId: res.locals.traceId,
    });
  }
});

// GET /api/telemetry/traces/:traceId - Get specific trace
router.get('/traces/:traceId', async (req, res) => {
  try {
    const { traceId } = req.params;
    const trace = await telemetryExporter.getTraceById(traceId);

    if (!trace || trace.length === 0) {
      return res.status(404).json({
        error: 'Trace not found',
        traceId: res.locals.traceId,
      });
    }

    res.json({
      trace,
      traceId,
      spans: trace.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching trace:', error);
    res.status(500).json({
      error: 'Failed to fetch trace',
      traceId: res.locals.traceId,
    });
  }
});

// GET /api/telemetry/logs - Get recent logs
router.get('/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const level = req.query.level as string;

    let logs = await telemetryExporter.getLogs(limit);

    // Filter by level if specified
    if (level) {
      logs = logs.filter(log => log.level === level);
    }

    res.json({
      logs,
      count: logs.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({
      error: 'Failed to fetch logs',
      traceId: res.locals.traceId,
    });
  }
});

// GET /api/telemetry/metrics - Get recent metrics
router.get('/metrics', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const name = req.query.name as string;

    let metrics = await telemetryExporter.getMetrics(limit);

    // Filter by metric name if specified
    if (name) {
      metrics = metrics.filter(metric => metric.name === name);
    }

    res.json({
      metrics,
      count: metrics.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({
      error: 'Failed to fetch metrics',
      traceId: res.locals.traceId,
    });
  }
});

// GET /api/telemetry/stats - Get telemetry statistics
router.get('/stats', async (req, res) => {
  try {
    const traces = await telemetryExporter.getTraces(1000);
    const logs = await telemetryExporter.getLogs(1000);
    const metrics = await telemetryExporter.getMetrics(1000);

    // Calculate some basic statistics
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
    console.error('Error calculating stats:', error);
    res.status(500).json({
      error: 'Failed to calculate telemetry stats',
      traceId: res.locals.traceId,
    });
  }
});

// POST /api/telemetry/logs - Add custom log entry
router.post('/logs', async (req, res) => {
  try {
    const { level, message, attributes } = req.body;
    const traceId = res.locals.traceId;

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
    console.error('Error adding log entry:', error);
    res.status(500).json({
      error: 'Failed to add log entry',
      traceId: res.locals.traceId,
    });
  }
});

export { router as telemetryRoutes };