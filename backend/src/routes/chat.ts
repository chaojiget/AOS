import { Router } from 'express';
import { ChatAgent } from '../agents/chat-agent';
import { JsonTraceExporter } from '../telemetry/json-exporter';

const router = Router();
const chatAgent = new ChatAgent();
const telemetryExporter = new JsonTraceExporter({ dataPath: './telemetry-data' });

// POST /api/chat - Send message to agent
router.post('/', async (req, res) => {
  try {
    const { message, conversationHistory } = req.body;
    const traceId = res.locals.traceId;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Message is required and must be a string',
        traceId,
      });
    }

    // Log the incoming request
    await telemetryExporter.logEvent('info', 'Chat request received', traceId, undefined, {
      messageLength: message.length,
      hasHistory: !!conversationHistory,
    });

    const startTime = Date.now();

    // Process the message with the agent
    const result = await chatAgent.processMessage(message, traceId);

    const responseTime = Date.now() - startTime;

    // Record metrics
    await telemetryExporter.recordMetric('chat.response_time', responseTime, 'ms', {
      success: true,
      messageLength: message.length,
    });

    await telemetryExporter.recordMetric('chat.requests_total', 1, 'count', {
      status: 'success',
    });

    // Log successful response
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

    // Log the error
    await telemetryExporter.logEvent('error', `Chat processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`, traceId, undefined, {
      error: error instanceof Error ? error.stack : 'Unknown error',
    });

    // Record error metrics
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

// POST /api/chat/stream - Stream response from agent
router.post('/stream', async (req, res) => {
  try {
    const { message } = req.body;
    const traceId = res.locals.traceId;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Message is required and must be a string',
        traceId,
      });
    }

    // Set headers for server-sent events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Log streaming request
    await telemetryExporter.logEvent('info', 'Streaming chat request received', traceId, undefined, {
      messageLength: message.length,
    });

    try {
      const response = await chatAgent.processStreamingMessage(message, traceId);

      // Send the complete response
      res.write(`data: ${JSON.stringify({ chunk: response, traceId })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true, traceId })}\n\n`);
      res.end();

      // Log successful streaming
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