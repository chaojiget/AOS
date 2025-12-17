import requests
import datetime

URL = "http://localhost:8080/api/v1/telemetry/logs"

payload = [
    {
        "level": "INFO",
        "logger_name": "manual.test_script",
        "message": "This is a verification log sent via HTTP API.",
        "trace_id": "test-trace-http-001",
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "attributes": {"source": "python-script", "foo": "bar"},
    },
    {
        "level": "WARNING",
        "logger_name": "manual.test_script",
        "message": "Testing warning color in dashboard.",
        "trace_id": "test-trace-http-001",
        "timestamp": datetime.datetime.utcnow().isoformat(),
    },
]

try:
    print(f"Sending to {URL}...")
    resp = requests.post(URL, json=payload, timeout=5)
    print(f"Status: {resp.status_code}")
    print(f"Response: {resp.text}")
except Exception as e:
    print(f"Failed: {e}")
