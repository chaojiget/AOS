from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from sqlmodel import Session, select

from aos_memory.llm_config import configure_openai_from_openrouter_env, resolve_model
from aos_storage.db import engine
from aos_storage.models import LogEntry


class MemoryCard(BaseModel):
    """A single distilled memory card."""

    title: str = Field(min_length=1, max_length=120)
    summary: str = Field(min_length=1, max_length=1200)
    tags: List[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)


@dataclass(frozen=True)
class DistillDeps:
    """Dependencies for the distillation agent."""

    service_name: str


def _safe_join_lines(lines: Iterable[str], *, limit_chars: int) -> str:
    out: list[str] = []
    total = 0
    for line in lines:
        if not line:
            continue
        remaining = limit_chars - total
        if remaining <= 0:
            break
        chunk = line if len(line) <= remaining else line[:remaining]
        out.append(chunk)
        total += len(chunk)
        if total >= limit_chars:
            break
    return "\n".join(out)


def _log_to_compact_text(log: LogEntry) -> str:
    parts = [
        f"time={log.timestamp.isoformat()}",
        f"level={log.level}",
        f"logger={log.logger_name}",
        f"trace_id={log.trace_id}",
        f"span_id={log.span_id}",
        f"parent_span_id={log.parent_span_id}",
        f"span_name={log.span_name}",
        f"msg={log.message}",
    ]
    return " | ".join(parts)


def build_distill_agent(model: str | None = None) -> Agent[DistillDeps, MemoryCard]:
    """Build a PydanticAI agent for turning logs into a memory card.

    Priority:
    - explicit `model`
    - `AOS_MEMORY_MODEL`
    - `AOS_AGENT_MODEL`
    - `LLM_MODEL` (OpenAI-compatible, e.g. OpenRouter)
    - fallback `deepseek:deepseek-chat`
    """

    configure_openai_from_openrouter_env()

    selected = resolve_model(
        explicit=model,
        env_fallbacks=("AOS_MEMORY_MODEL", "AOS_AGENT_MODEL", "LLM_MODEL"),
        default="deepseek:deepseek-chat",
    )

    return Agent(
        selected,
        deps_type=DistillDeps,
        output_type=MemoryCard,
        system_prompt=(
            "You are Odysseus, a log distillation agent. "
            "Given a trace worth of logs, produce ONE memory card.\n\n"
            "Rules:\n"
            "- Be specific about what happened and what to do next time.\n"
            "- Tags must be short, lowercase, no spaces, e.g. ['db', 'timeout', 'retry'].\n"
            "- Confidence should reflect how strongly the logs support the conclusion.\n"
            "- Avoid secrets, passwords, API keys; redact if present.\n"
        ),
    )


def distill_trace_with_llm(
    trace_id: str,
    *,
    model: str | None = None,
    max_logs: int = 200,
    max_chars: int = 18_000,
) -> MemoryCard | None:
    """Fetch logs for a trace, ask LLM to generate a MemoryCard."""

    trace_id = trace_id.strip()
    if not trace_id:
        return None

    with Session(engine) as session:
        statement = (
            select(LogEntry)
            .where(LogEntry.trace_id == trace_id)
            .order_by(LogEntry.timestamp)
            .limit(max_logs)
        )
        logs = session.exec(statement).all()

    if not logs:
        return None

    lines = [_log_to_compact_text(log) for log in logs]
    payload = _safe_join_lines(lines, limit_chars=max_chars)

    agent = build_distill_agent(model)
    result = agent.run_sync(
        "Distill this trace into one actionable memory card.\n\n"
        f"trace_id: {trace_id}\n"
        f"log_count: {len(logs)}\n\n"
        f"logs:\n{payload}\n",
        deps=DistillDeps(service_name="aos"),
    )
    return result.output
