from __future__ import annotations

import os
from typing import List, Optional

from sqlmodel import Session, select

from aos_memory.memory_cards import distill_trace_with_llm
from aos_storage.db import engine
from aos_storage.models import WisdomItem


class OdysseusService:
    """The Observer.

    Responsible for extracting wisdom ("memory cards") from traces.
    """

    def distill_trace(
        self, trace_id: str, *, overwrite: bool = False
    ) -> Optional[WisdomItem]:
        """Analyze a trace and persist a WisdomItem.

        If `AOS_MEMORY_LLM=1`, distillation uses PydanticAI + your configured model.
        Otherwise it falls back to the heuristic prototype.

        Idempotency: if `overwrite` is False and a WisdomItem already exists for the
        given `trace_id`, the existing item is returned.
        """

        trace_id = trace_id.strip()
        if not trace_id:
            return None

        use_llm = os.getenv("AOS_MEMORY_LLM", "0").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }

        if use_llm:
            from aos_memory.llm_config import configure_openai_from_openrouter_env

            configure_openai_from_openrouter_env()

        with Session(engine) as session:
            if not overwrite:
                existing = session.exec(
                    select(WisdomItem).where(WisdomItem.source_trace_id == trace_id)
                ).first()
                if existing is not None:
                    return existing

            if use_llm:
                card = distill_trace_with_llm(trace_id)
                if card is None:
                    return None

                wisdom = WisdomItem(
                    source_trace_id=trace_id,
                    title=card.title,
                    content=card.summary,
                    tags=",".join(card.tags),
                )
                session.add(wisdom)
                session.commit()
                session.refresh(wisdom)
                return wisdom

            # --- Heuristic fallback (no network / no model configured) ---
            from aos_storage.models import LogEntry

            statement = (
                select(LogEntry)
                .where(LogEntry.trace_id == trace_id)
                .order_by(LogEntry.timestamp)
            )
            logs = session.exec(statement).all()

            if not logs:
                return None

            error_count = sum(1 for log in logs if log.level == "ERROR")
            unique_loggers = sorted(
                {log.logger_name for log in logs if log.logger_name}
            )
            primary_logger = unique_loggers[0] if unique_loggers else "unknown"

            duration_s = (
                (logs[-1].timestamp - logs[0].timestamp).total_seconds()
                if len(logs) > 1
                else 0.0
            )

            if error_count > 0:
                title = f"Failure Pattern Detected in {primary_logger}"
                last_message = (logs[-1].message or "").strip()
                content = (
                    f"Trace {trace_id[:8]} encountered {error_count} errors. "
                    f"Primary source: {last_message[:120]}"
                )
                tags = "bug,error,failure"
            else:
                title = f"Successful Execution: {primary_logger}"
                content = (
                    f"Completed task in {duration_s:.2f}s. "
                    f"Steps involved: {len(logs)} entries."
                )
                tags = "success,performance"

            wisdom = WisdomItem(
                source_trace_id=trace_id,
                title=title,
                content=content,
                tags=tags,
            )
            session.add(wisdom)
            session.commit()
            session.refresh(wisdom)
            return wisdom

    def get_all_wisdom(self, *, limit: int | None = None) -> List[WisdomItem]:
        with Session(engine) as session:
            statement = select(WisdomItem).order_by(WisdomItem.created_at.desc())
            if limit is not None:
                statement = statement.limit(limit)
            return list(session.exec(statement).all())

    def get_wisdom_by_trace(self, trace_id: str) -> Optional[WisdomItem]:
        trace_id = trace_id.strip()
        if not trace_id:
            return None

        with Session(engine) as session:
            statement = select(WisdomItem).where(WisdomItem.source_trace_id == trace_id)
            return session.exec(statement).first()

    def search_wisdom(self, query: str, *, limit: int = 20) -> List[WisdomItem]:
        """Simple keyword search across title/tags/content."""

        needle = query.strip()
        if not needle:
            return []

        with Session(engine) as session:
            statement = (
                select(WisdomItem)
                .where(
                    (WisdomItem.title.contains(needle))
                    | (WisdomItem.tags.contains(needle))
                    | (WisdomItem.content.contains(needle))
                )
                .order_by(WisdomItem.created_at.desc())
                .limit(limit)
            )
            return list(session.exec(statement).all())
