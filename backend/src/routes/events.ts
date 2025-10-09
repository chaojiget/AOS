import { Router } from 'express';
import { getPool } from '../db/postgres';
import { getAuthContext, requireAuth } from '../auth/middleware';
import {
  appendValueEvent,
  ensureValueEventInfrastructure,
  listValueEvents,
  mapNotificationPayload,
  VALUE_EVENT_CHANNEL,
  ValueEventRecord,
} from '../events/value-events';

const router = Router();

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

router.get('/', requireAuth('events.read'), async (req, res) => {
  const traceId = res.locals.traceId;
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const events = await listValueEvents(limit);

    res.json({
      events,
      count: events.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Events] 查询失败:', error);
    res.status(500).json({
      error: '查询价值事件失败',
      traceId,
    });
  }
});

router.post('/', requireAuth('events.write'), async (req, res) => {
  const traceId = res.locals.traceId;
  const body = req.body as Record<string, unknown> | undefined;

  const eventType = typeof body?.eventType === 'string' ? body?.eventType.trim() : '';
  if (!eventType) {
    return res.status(400).json({
      error: 'eventType 必填',
      traceId,
    });
  }

  const status = typeof body?.status === 'string' ? body.status.trim() : undefined;
  const trace = typeof body?.traceId === 'string' ? body.traceId.trim() : undefined;
  const title = typeof body?.title === 'string' ? body.title.trim() : undefined;
  const summary = typeof body?.summary === 'string' ? body.summary.trim() : undefined;

  const payload = isPlainRecord(body?.payload) ? body?.payload : undefined;
  const metadata = isPlainRecord(body?.metadata) ? body?.metadata : undefined;

  const action = isPlainRecord(body?.action) ? body?.action : undefined;
  const actionLabel = typeof action?.label === 'string' ? action.label : undefined;
  const actionHref = typeof action?.href === 'string' ? action.href : undefined;

  const occurredAt = typeof body?.occurredAt === 'string' ? new Date(body.occurredAt) : undefined;
  if (occurredAt && Number.isNaN(occurredAt.getTime())) {
    return res.status(400).json({
      error: 'occurredAt 非法',
      traceId,
    });
  }

  try {
    const event = await appendValueEvent({
      eventType,
      status,
      traceId: trace,
      title,
      summary,
      payload,
      metadata,
      actionLabel,
      actionHref,
      occurredAt,
    });

    const auth = getAuthContext(req);
    if (auth) {
      console.info('[Events] 新增价值事件', {
        id: event.id,
        eventType: event.eventType,
        actor: auth.subject,
      });
    }

    res.status(201).json({ event });
  } catch (error) {
    console.error('[Events] 写入失败:', error);
    res.status(500).json({
      error: '写入价值事件失败',
      traceId,
    });
  }
});

router.get('/stream', requireAuth('events.subscribe'), async (req, res) => {
  const traceId = res.locals.traceId;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;
  let heartbeat: NodeJS.Timeout | null = null;
  const pool = getPool();
  const client = await pool.connect();

  const cleanup = async () => {
    if (closed) return;
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    try {
      await client.query(`UNLISTEN ${VALUE_EVENT_CHANNEL}`);
    } catch (error) {
      console.error('[Events] 取消监听失败', error);
    }
    client.release();
  };

  try {
    await ensureValueEventInfrastructure();
    await client.query(`LISTEN ${VALUE_EVENT_CHANNEL}`);
  } catch (error) {
    console.error('[Events] 监听价值事件失败:', error);
    res.write(`event: error\ndata: ${JSON.stringify({ error: '订阅失败', traceId })}\n\n`);
    await cleanup();
    res.end();
    return;
  }

  const sendEvent = (event: ValueEventRecord) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  client.on('notification', (msg) => {
    if (!msg.payload) return;
    try {
      const event = mapNotificationPayload(msg.payload);
      sendEvent(event);
    } catch (error) {
      console.error('[Events] 推送解析失败:', error);
    }
  });

  client.on('error', async (error) => {
    console.error('[Events] 通知连接错误:', error);
    if (!closed) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: '通知通道异常', traceId })}\n\n`);
      res.end();
      await cleanup();
    }
  });

  heartbeat = setInterval(() => {
    if (!closed) {
      res.write(': heartbeat\n\n');
    }
  }, 15000);

  req.on('close', async () => {
    await cleanup();
  });

  req.on('end', async () => {
    await cleanup();
  });

  res.write(': connected\n\n');
});

export { router as valueEventRoutes };
