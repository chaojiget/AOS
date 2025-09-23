import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { JsonTraceExporter } from './json-exporter';

export const setupTelemetry = () => {
  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: 'aos-chat-backend',
      [ATTR_SERVICE_VERSION]: '1.0.0',
    }),
    traceExporter: new JsonTraceExporter({
      dataPath: './telemetry-data'
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  // Initialize the SDK and register with the OpenTelemetry API
  sdk.start();

  console.log('OpenTelemetry started successfully');

  // Gracefully shutdown the SDK on process exit
  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => console.log('OpenTelemetry terminated'))
      .catch((error) => console.log('Error terminating OpenTelemetry', error))
      .finally(() => process.exit(0));
  });

  return sdk;
};