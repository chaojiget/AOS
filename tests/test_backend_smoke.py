def test_backend_routes_exist() -> None:
    from aos_backend.main import app

    paths = {route.path for route in app.routes}
    assert "/api/v1/telemetry/logs" in paths
    assert "/api/v1/telemetry/traces" in paths
    assert "/api/v1/telemetry/traces/{trace_id}/logs" in paths
    assert "/api/v1/memory/recall" in paths
    assert "/api/v1/memory/consolidate" in paths
    assert "/api/v1/ag-ui" in paths
