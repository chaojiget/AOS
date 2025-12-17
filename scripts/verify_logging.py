import logging
import sys

# Ensure packages are found
sys.path.append("packages/aos_telemetry/src")
sys.path.append("packages/aos_storage/src")

from aos_telemetry.config import setup_telemetry
from aos_storage.db import get_session
from aos_storage.models import LogEntry
from sqlmodel import select


def main():
    # 1. Setup
    print("Setting up telemetry...")
    tracer = setup_telemetry("aos-verifier")
    logger = logging.getLogger("aos.verifier")

    # 2. Generate Logs within a Span
    print("Generating logs...")
    with tracer.start_as_current_span("verification-task"):
        logger.info("This is a test INFO log from the verifier.")
        logger.warning("This is a WARNING log.")
        try:
            1 / 0
        except ZeroDivisionError:
            logger.error("Captured an exception!", exc_info=True)

    # 3. Verify DB
    print("Verifying database...")
    # New session
    db_session = next(get_session())
    statement = select(LogEntry).order_by(LogEntry.id.desc())
    results = db_session.exec(statement).all()

    if not results:
        print("❌ No logs found in DB!")
        exit(1)

    print(f"✅ Found {len(results)} logs in DB.")
    for log in results[:3]:
        print(f"[{log.id}] {log.level} | Trace: {log.trace_id} | Msg: {log.message}")


if __name__ == "__main__":
    main()
