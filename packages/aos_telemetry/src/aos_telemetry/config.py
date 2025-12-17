import logging
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.sdk.resources import SERVICE_NAME, Resource

def setup_telemetry(service_name: str, log_level=logging.INFO):
    """
    Initializes OpenTelemetry globally.
    """
    # 1. Resource Logic
    resource = Resource(attributes={
        SERVICE_NAME: service_name
    })

    # 2. Tracer Provider
    provider = TracerProvider(resource=resource)
    
    # 3. Exporter (Console - simple for now, can add OTLP later)
    # Using ConsoleSpanExporter for immediate feedback during dev
    processor = BatchSpanProcessor(ConsoleSpanExporter())
    provider.add_span_processor(processor)

    # 4. Set Global
    trace.set_tracer_provider(provider)

    # 5. Basic Logging Config
    logging.basicConfig(level=log_level, format='%(asctime)s [%(name)s] %(levelname)s: %(message)s')
    
    return trace.get_tracer(service_name)
