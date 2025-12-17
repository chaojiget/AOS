from typing import List, Optional
from sqlmodel import Session, select
from aos_storage.models import LogEntry, WisdomItem
from aos_storage.db import engine

class OdysseusService:
    """
    The Observer. Responsible for extracting wisdom from the chaos of Sisyphus's logs.
    """
    
    def distill_trace(self, trace_id: str) -> Optional[WisdomItem]:
        """
        Analyzes a specific trace and generates a WisdomItem.
        In a real system, this would call an LLM (e.g., 'Analyze these logs and summarize').
        Here, we use heuristic rules for the prototype.
        """
        with Session(engine) as session:
            # 1. Fetch Logs for Trace
            statement = select(LogEntry).where(LogEntry.trace_id == trace_id).order_by(LogEntry.timestamp)
            logs = session.exec(statement).all()
            
            if not logs:
                return None
                
            # 2. Analyze (Heuristic Mock)
            error_count = sum(1 for log in logs if log.level == "ERROR")
            unique_loggers = set(log.logger_name for log in logs)
            duration = (logs[-1].timestamp - logs[0].timestamp).total_seconds() if len(logs) > 1 else 0
            
            # 3. Generate Insight
            if error_count > 0:
                title = f"Failure Pattern Detected in {list(unique_loggers)[0]}"
                content = f"Trace {trace_id[:8]} encountered {error_count} errors. Primary source: {logs[-1].message[:50]}..."
                tags = "bug, error, failure"
            else:
                title = f"Successful Execution: {list(unique_loggers)[0]}"
                content = f"Completed task in {duration:.2f}s. Steps involved: {len(logs)} entries."
                tags = "success, performance"

            # 4. Save Wisdom
            wisdom = WisdomItem(
                source_trace_id=trace_id,
                title=title,
                content=content,
                tags=tags
            )
            session.add(wisdom)
            session.commit()
            session.refresh(wisdom)
            
            return wisdom

    def get_all_wisdom(self) -> List[WisdomItem]:
        with Session(engine) as session:
            return session.exec(select(WisdomItem).order_by(WisdomItem.created_at.desc())).all()
            
    def search_wisdom(self, query: str) -> List[WisdomItem]:
        """Simple keyword search."""
        with Session(engine) as session:
            # SQLModel/SQLAlchemy simple contains search
            statement = select(WisdomItem).where(
                (WisdomItem.title.contains(query)) | 
                (WisdomItem.tags.contains(query))
            )
            return session.exec(statement).all()
