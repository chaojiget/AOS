import { Router } from 'express';
import { ChatAgent } from '../agents/chat-agent';
import { TelemetryInitializationError, TelemetryStorageError } from '../telemetry/nats-exporter';
import { getTelemetryExporter } from '../telemetry/provider';
import { logClient } from '../services/log-client';

const router = Router();
const chatAgent = new ChatAgent();
const telemetryExporter = getTelemetryExporter();

router.post('/', async (req, res) => {
  try {
    await telemetryExporter.ensureReady();

    const { message, conversationId, conversationHistory } = req.body;
    const traceId = res.locals.traceId;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Message is required and must be a string',
        traceId,
      });
    }

    await logClient.write({
      level: 'info',
      message: '收到聊天请求',
      traceId,
      topic: 'chat.request',
      attributes: {
        messageLength: message.length,
        hasHistory: !!conversationHistory,
      },
    });

    const startTime = Date.now();

    const result = await chatAgent.processMessage(message, traceId, conversationId, conversationHistory);

    const responseTime = Date.now() - startTime;

    await telemetryExporter.recordMetric('chat.response_time', responseTime, 'ms', {
      success: true,
      messageLength: message.length,
    });

    await telemetryExporter.recordMetric('chat.requests_total', 1, 'count', {
      status: 'success',
    });

    await logClient.write({
      level: 'info',
      message: '发送聊天响应',
      traceId,
      topic: 'chat.response',
      attributes: {
        responseLength: result.response.length,
        duration: responseTime,
      },
    });

    res.json({
      message: result.response,
      traceId: result.traceId,
      timestamp: new Date().toISOString(),
      responseTime,
      status: 'success',
    });

  } catch (error) {
    const traceId = res.locals.traceId;

    if (error instanceof TelemetryInitializationError) {
      console.error('NATS JetStream 不可用，无法写入遥测数据:', error);
      return res.status(500).json({
        error: '遥测队列未初始化，服务暂不可用',
        traceId,
      });
    }

    if (error instanceof TelemetryStorageError) {
      console.error('NATS JetStream 遥测入队失败:', error);
      return res.status(500).json({
        error: '遥测服务异常，无法处理请求',
        traceId,
      });
    }

    console.error('Chat route error:', error);

    try {
      await logClient.write({
        level: 'error',
        message: `Chat processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        traceId,
        topic: 'chat.error',
        attributes: {
          error: error instanceof Error ? error.stack : 'Unknown error',
        },
      });
      await telemetryExporter.recordMetric('chat.requests_total', 1, 'count', {
        status: 'error',
      });
    } catch (telemetryError) {
      console.error('记录遥测失败:', telemetryError);
    }

    res.status(500).json({
      error: 'Failed to process chat message',
      traceId,
      timestamp: new Date().toISOString(),
    });
  }
});

router.post('/stream', async (req, res) => {
  try {
    await telemetryExporter.ensureReady();

    const { message, conversationId, conversationHistory } = req.body;
    const traceId = res.locals.traceId;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Message is required and must be a string',
        traceId,
      });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    await logClient.write({
      level: 'info',
      message: '收到流式聊天请求',
      traceId,
      topic: 'chat.stream.start',
      attributes: {
        messageLength: message.length,
      },
    });

    try {
      for await (const chunk of chatAgent.streamText(message, conversationId, conversationHistory)) {
        res.write(`data: ${JSON.stringify({ chunk, traceId })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true, traceId })}\n\n`);
      res.end();

      await logClient.write({
        level: 'info',
        message: '流式响应完成',
        traceId,
        topic: 'chat.stream.done',
      });

    } catch (streamError) {
      console.error('Streaming error:', streamError);

      await logClient.write({
        level: 'error',
        message: `Streaming failed: ${streamError instanceof Error ? streamError.message : 'Unknown error'}`,
        traceId,
        topic: 'chat.stream.error',
      });

      res.write(`data: ${JSON.stringify({
        error: 'Streaming failed',
        traceId
      })}\n\n`);
      res.end();
    }

  } catch (error) {
    const traceId = res.locals.traceId;

    if (error instanceof TelemetryInitializationError) {
      console.error('NATS JetStream 不可用，无法写入遥测数据:', error);
      return res.status(500).json({
        error: '遥测队列未初始化，服务暂不可用',
        traceId,
      });
    }

    if (error instanceof TelemetryStorageError) {
      console.error('NATS JetStream 遥测入队失败:', error);
      return res.status(500).json({
        error: '遥测服务异常，无法处理请求',
        traceId,
      });
    }

    console.error('Stream route error:', error);

    try {
      await logClient.write({
        level: 'error',
        message: `Stream setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        traceId,
        topic: 'chat.stream.error',
      });
    } catch (telemetryError) {
      console.error('记录遥测失败:', telemetryError);
    }

    res.status(500).json({
      error: 'Failed to setup streaming',
      traceId,
    });
  }
});

export { router as chatRoutes };
