import 'dotenv/config';
import { setupTelemetry } from './telemetry/setup';

// Initialize OpenTelemetry before importing other modules
const sdk = setupTelemetry();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { chatRoutes } from './routes/chat';
import { telemetryRoutes } from './routes/telemetry';
import { logRoutes } from './routes/logs';
import { mcpRoutes } from './routes/mcp';
import { initMcpSubsystem } from './mcp/init';
import { trace } from '@opentelemetry/api';
import { closePool } from './db/postgres';
import { valueEventRoutes } from './routes/events';
import projectsRoutes from './routes/projects';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3001',
    'http://localhost:3000',
    'http://localhost:3001',
    /^http:\/\/.*\..*$/  // 允许任意带点的 http:// 来源，例如内网调试域名
  ],
  credentials: true,
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Add tracing middleware
app.use((req, res, next) => {
  const tracer = trace.getTracer('express-server');
  const span = tracer.startSpan(`${req.method} ${req.path}`);

  span.setAttributes({
    'http.method': req.method,
    'http.url': req.url,
    'http.path': req.path,
    'http.user_agent': req.get('User-Agent') || '',
    'http.remote_addr': req.ip,
  });

  // Store span in response locals for access in routes
  res.locals.span = span;
  res.locals.traceId = span.spanContext().traceId;

  res.on('finish', () => {
    span.setAttributes({
      'http.status_code': res.statusCode,
      'http.response_size': res.get('Content-Length') || 0,
    });
    span.end();
  });

  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// API Routes
app.use('/api/chat', chatRoutes);
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/events', valueEventRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/mcp', mcpRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', error);

  if (res.locals.span) {
    res.locals.span.setStatus({
      code: 2, // ERROR
      message: error.message,
    });
  }

  res.status(500).json({
    error: 'Internal server error',
    traceId: res.locals.traceId,
  });
});

// Start server
const startServer = async () => {
  try {
    await initMcpSubsystem();
    app.listen(PORT, () => {
      console.log(`🚀 AOS Backend server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`💬 Chat API: http://localhost:${PORT}/api/chat`);
      console.log(`📈 Telemetry API: http://localhost:${PORT}/api/telemetry`);
      console.log(`🔌 MCP API: http://localhost:${PORT}/mcp`);
    });
  } catch (error) {
    console.error('启动 MCP 子系统失败', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await sdk.shutdown();
  await closePool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await sdk.shutdown();
  await closePool();
  process.exit(0);
});
