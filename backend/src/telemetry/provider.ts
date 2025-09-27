import { NatsTelemetryExporter } from './nats-exporter';

let exporter: NatsTelemetryExporter | null = null;

export const getTelemetryExporter = (): NatsTelemetryExporter => {
  if (!exporter) {
    exporter = new NatsTelemetryExporter({ maxMessages: 1000 });
  }
  return exporter;
};
