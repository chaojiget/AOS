import { Router } from 'express';
import { ChatAgent } from '../agents/chat-agent';
import { JsonTraceExporter } from '../telemetry/json-exporter';

const router = Router();
const chatAgent = new ChatAgent();
const telemetryExporter = new JsonTraceExporter({ dataPath: './telemetry-data' });

router.post('/', async (req, res) => {
  try {
    const { message, conversationId, conversationHistory } = req.body;
    const traceId = res.locals.traceId;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Message is required and must be a string',
        traceId,
      });
    }

    await telemetryExporter.logEvent('info', 'Chat request received', traceId, undefined, {
      messageLength: message.length,
      hasHistory: !!conversationHistory,
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

    await telemetryExporter.logEvent('info', 'Chat response sent', traceId, undefined, {
      responseLength: result.response.length,
      duration: responseTime,
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

    console.error('Chat route error:', error);

    await telemetryExporter.logEvent('error', `Chat processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`, traceId, undefined, {
      error: error instanceof Error ? error.stack : 'Unknown error',
    });

    await telemetryExporter.recordMetric('chat.requests_total', 1, 'count', {
      status: 'error',
    });

    res.status(500).json({
      error: 'Failed to process chat message',
      traceId,
      timestamp: new Date().toISOString(),
    });
  }
});

router.post('/stream', async (req, res) => {
  try {
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

    await telemetryExporter.logEvent('info', 'Streaming chat request received', traceId, undefined, {
      messageLength: message.length,
    });

    try {
      for await (const chunk of chatAgent.streamText(message, conversationId, conversationHistory)) {
        res.write(`data: ${JSON.stringify({ chunk, traceId })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true, traceId })}\n\n`);
      res.end();

      await telemetryExporter.logEvent('info', 'Streaming response completed', traceId);

    } catch (streamError) {
      console.error('Streaming error:', streamError);

      await telemetryExporter.logEvent('error', `Streaming failed: ${streamError instanceof Error ? streamError.message : 'Unknown error'}`, traceId);

      res.write(`data: ${JSON.stringify({
        error: 'Streaming failed',
        traceId
      })}\n\n`);
      res.end();
    }

  } catch (error) {
    const traceId = res.locals.traceId;

    console.error('Stream route error:', error);

    await telemetryExporter.logEvent('error', `Stream setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`, traceId);

    res.status(500).json({
      error: 'Failed to setup streaming',
      traceId,
    });
  }
});

export { router as chatRoutes };
