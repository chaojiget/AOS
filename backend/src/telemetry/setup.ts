import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { JsonTraceExporter } from './json-exporter';
import { NatsTelemetryExporter, TelemetryInitializationError } from './nats-exporter';

const TELEMETRY_DATA_PATH = './telemetry-data';

const createTraceExporter = () => {
  const backend = (process.env.TELEMETRY_STORAGE || 'nats').toLowerCase();

  if (backend === 'json') {
    return new JsonTraceExporter({ dataPath: TELEMETRY_DATA_PATH });
  }

  const exporter = new NatsTelemetryExporter({ maxMessages: 1000 });

  exporter.ensureReady().catch((error) => {
    if (error instanceof TelemetryInitializationError) {
      console.error('NATS JetStream 初始化失败，后续追踪将无法写入队列:', error);
    } else {
      console.error('NATS JetStream 初始化过程中出现未知错误:', error);
    }
  });

  return exporter;
};

export const setupTelemetry = () => {
  const traceExporter = createTraceExporter();

  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: 'aos-chat-backend',
      [ATTR_SERVICE_VERSION]: '1.0.0',
    }),
    traceExporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();

  console.log('OpenTelemetry 启动成功');

  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => console.log('OpenTelemetry 已终止'))
      .catch((error) => console.log('OpenTelemetry 终止失败', error))
      .finally(() => process.exit(0));
  });

  return sdk;
};
