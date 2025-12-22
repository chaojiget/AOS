from __future__ import annotations

import logging
import os
import re
import shlex
import subprocess
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.exceptions import UserError
from sqlmodel import Session, select

from aos_memory.entropy import EntropyService
from aos_memory.llm_config import configure_openai_from_openrouter_env, resolve_model
from aos_memory.odysseus import OdysseusService
from aos_storage.db import engine
from aos_storage.models import LogEntry, WisdomItem
from aos_telemetry.config import setup_telemetry

REPO_ROOT = Path(__file__).resolve().parents[4]

_ALLOWED_COMMANDS = {"rg", "ls", "git"}
_GIT_SAFE_SUBCOMMANDS = {"status", "log", "diff", "show", "rev-parse"}

_MAX_TOOL_OUTPUT_CHARS = 12_000
_MAX_FILE_CHARS = 12_000

_MAX_TRACE_LOGS = 120
_MAX_TRACE_CHAR_BUDGET = 24_000

_SECRET_RE = re.compile(
    r"(?i)(api[_-]?key|secret|password|passwd|token|bearer)\s*[:=]\s*[^\s]+"
)


class SisyphusReply(BaseModel):
    """Agent output returned to the caller.

    Keep this user-facing: no chain-of-thought.
    """

    answer: str = Field(min_length=1, max_length=4000)
    next_steps: list[str] = Field(default_factory=list, max_length=10)


@dataclass(frozen=True)
class SisyphusDeps:
    repo_root: Path
    logger: logging.Logger
    odysseus: OdysseusService
    trace_id: str
    memory_context: str


def _redact_secrets(text: str) -> str:
    return _SECRET_RE.sub("<redacted>", text)


def _truncate(text: str, *, limit: int) -> str:
    redacted = _redact_secrets(text)
    if len(redacted) <= limit:
        return redacted
    return redacted[:limit] + "\n…(truncated)"


def _format_wisdom(items: list[WisdomItem], *, max_chars: int = 6000) -> str:
    lines: list[str] = []
    used = 0
    for item in items:
        title = (item.title or "").strip()
        content = (item.content or "").strip()
        tags = (item.tags or "").strip()
        trace_id = (item.source_trace_id or "").strip()

        block = "\n".join(
            [
                f"- title: {title}",
                f"  tags: {tags}",
                f"  trace_id: {trace_id}",
                "  content:",
                "    " + _truncate(content, limit=800).replace("\n", "\n    "),
            ]
        )
        if not block.strip():
            continue

        if used + len(block) + 2 > max_chars:
            break
        lines.append(block)
        used += len(block) + 2

    return "\n\n".join(lines)


def _format_log_line(log: LogEntry) -> str:
    msg = (log.message or "").strip()
    msg = _truncate(msg, limit=600)
    return " | ".join(
        [
            f"ts={log.timestamp.isoformat()}",
            f"level={log.level}",
            f"logger={log.logger_name}",
            f"trace_id={log.trace_id}",
            f"span_id={log.span_id}",
            f"parent_span_id={log.parent_span_id}",
            f"span_name={log.span_name}",
            f"msg={msg}",
        ]
    )


def _build_trace_context(trace_id: str) -> str:
    with Session(engine) as session:
        stmt = (
            select(LogEntry)
            .where(LogEntry.trace_id == trace_id)
            .order_by(LogEntry.timestamp)  # type: ignore[arg-type]
            .limit(_MAX_TRACE_LOGS)
        )
        logs = list(session.exec(stmt).all())

    lines = [_format_log_line(log) for log in logs]
    text = "\n".join(lines)
    return _truncate(text, limit=_MAX_TRACE_CHAR_BUDGET)


def _save_agent_log(
    trace_id: str | None, logger: logging.Logger, message: str, *, level: str = "INFO"
) -> None:
    if not trace_id:
        return

    with Session(engine) as session:
        entry = LogEntry(
            level=level,
            logger_name=logger.name,
            message=_truncate(message, limit=2000),
            trace_id=trace_id,
            span_id=None,
            parent_span_id=None,
            span_name=None,
            timestamp=datetime.utcnow(),
            attributes=None,
        )
        session.add(entry)
        session.commit()


def build_sisyphus_llm_agent(model: str) -> Agent[SisyphusDeps, SisyphusReply]:
    agent: Agent[SisyphusDeps, SisyphusReply] = Agent(
        model,
        deps_type=SisyphusDeps,
        output_type=SisyphusReply,
        system_prompt=(
            "You are Sisyphus, an execution agent inside the AOS repo. "
            "Your job: turn the user's instruction into an actionable answer.\n\n"
            "Constraints (important):\n"
            "- Never reveal secrets. Redact anything that looks like keys/passwords.\n"
            "- Prefer using tools to verify facts (read_file/search_code/list_dir).\n"
            "- Use run_command only for read-only commands.\n"
            "- Keep output concise and actionable.\n"
        ),
    )

    @agent.system_prompt
    def _add_memory(ctx: RunContext[SisyphusDeps]) -> str:
        memory = ctx.deps.memory_context.strip()
        if not memory:
            return "No memory cards available yet."
        return "Relevant memory cards (inverse-entropy distilled):\n" + memory

    @agent.system_prompt
    def _add_recent_trace(ctx: RunContext[SisyphusDeps]) -> str:
        trace = _build_trace_context(ctx.deps.trace_id)
        if not trace.strip():
            return "No trace logs available."
        return "Trace logs for this run (chronological):\n" + trace

    @agent.tool
    def list_dir(ctx: RunContext[SisyphusDeps], path: str = ".") -> str:
        """List files under a relative path in repo."""

        rel = path.strip() or "."
        target = (ctx.deps.repo_root / rel).resolve()
        if ctx.deps.repo_root not in target.parents and target != ctx.deps.repo_root:
            return "error: path outside repo"

        try:
            entries = sorted(p.name for p in target.iterdir())
        except FileNotFoundError:
            return "error: directory not found"

        ctx.deps.logger.info("Tool:list_dir path=%s entries=%s", rel, len(entries))
        return _truncate("\n".join(entries), limit=_MAX_TOOL_OUTPUT_CHARS)

    @agent.tool
    def read_file(ctx: RunContext[SisyphusDeps], path: str) -> str:
        """Read a text file (truncated)."""

        rel = path.strip()
        if not rel:
            return "error: empty path"

        target = (ctx.deps.repo_root / rel).resolve()
        if ctx.deps.repo_root not in target.parents:
            return "error: path outside repo"

        try:
            content = target.read_text(encoding="utf-8", errors="replace")
        except FileNotFoundError:
            return "error: file not found"

        ctx.deps.logger.info("Tool:read_file path=%s chars=%s", rel, len(content))
        return _truncate(content, limit=_MAX_FILE_CHARS)

    @agent.tool
    def search_code(ctx: RunContext[SisyphusDeps], pattern: str) -> str:
        """Search code using ripgrep (rg)."""

        needle = pattern.strip()
        if not needle:
            return "error: empty pattern"

        args = [
            "rg",
            "-n",
            "--max-count",
            "80",
            needle,
            str(ctx.deps.repo_root),
        ]
        ctx.deps.logger.info("Tool:search_code pattern=%s", needle)

        try:
            result = subprocess.run(
                args,
                capture_output=True,
                text=True,
                cwd=ctx.deps.repo_root,
                timeout=12,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return "error: search timeout"

        output = (result.stdout or "") + (result.stderr or "")
        return _truncate(output.strip() or "(no matches)", limit=_MAX_TOOL_OUTPUT_CHARS)

    @agent.tool
    def run_command(ctx: RunContext[SisyphusDeps], command: str) -> str:
        """Run a safe, read-only shell command (no shell)."""

        raw = command.strip()
        if not raw:
            return "error: empty command"

        try:
            argv = shlex.split(raw)
        except ValueError as exc:
            return f"error: invalid command: {exc}"

        if not argv:
            return "error: empty command"

        cmd = argv[0]
        if cmd not in _ALLOWED_COMMANDS:
            return f"error: command '{cmd}' not allowed (allowed: {', '.join(sorted(_ALLOWED_COMMANDS))})"

        if cmd == "git":
            sub = argv[1] if len(argv) > 1 else ""
            if sub not in _GIT_SAFE_SUBCOMMANDS:
                return f"error: git subcommand '{sub}' not allowed (allowed: {', '.join(sorted(_GIT_SAFE_SUBCOMMANDS))})"

        ctx.deps.logger.info("Tool:run_command cmd=%s", raw)
        try:
            result = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                cwd=ctx.deps.repo_root,
                timeout=20,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return "error: command timeout"

        output = (result.stdout or "") + (result.stderr or "")
        output = output.strip() or "(no output)"
        ctx.deps.logger.info(
            "Tool:run_command done rc=%s out_chars=%s", result.returncode, len(output)
        )
        return _truncate(output, limit=_MAX_TOOL_OUTPUT_CHARS)

    @agent.tool
    def search_memory(ctx: RunContext[SisyphusDeps], query: str, limit: int = 5) -> str:
        """Search memory cards (WisdomItem) by keyword."""

        needle = query.strip()
        if not needle:
            return "error: empty query"

        items = ctx.deps.odysseus.search_wisdom(needle, limit=limit)
        ctx.deps.logger.info("Tool:search_memory query=%s hits=%s", needle, len(items))
        if not items:
            return "(no memory hits)"
        return _format_wisdom(items, max_chars=6000)

    return agent


class SisyphusAgent:
    def __init__(self, agent_id: str = "sisyphus-01"):
        self.agent_id = agent_id

        self.tracer = setup_telemetry(f"agent.{agent_id}")
        self.logger = logging.getLogger(f"aos.agent.{agent_id}")

        self.entropy = EntropyService()
        self.odysseus = OdysseusService()

        configure_openai_from_openrouter_env()

        model = resolve_model(
            explicit=os.getenv("AOS_AGENT_MODEL"),
            env_fallbacks=("LLM_MODEL",),
            default="deepseek:deepseek-chat",
        )
        self.llm: Agent[SisyphusDeps, SisyphusReply] | None = None
        try:
            self.llm = build_sisyphus_llm_agent(model)
        except UserError as exc:
            self.logger.warning("LLM disabled: %s", exc)

        self.current_trace_id: str | None = None

    def run_task(self, instruction: str) -> dict[str, Any]:
        instruction = instruction.strip()
        if not instruction:
            return {"status": "error", "error": "empty instruction"}

        with self.tracer.start_as_current_span("task_execution") as span:
            if span.get_span_context().is_valid:
                self.current_trace_id = format(span.get_span_context().trace_id, "032x")
            else:
                self.current_trace_id = uuid.uuid4().hex

            self.logger.info("Thinking: received task")
            self.logger.info("Task: %s", instruction)

            recent_wisdom = self.odysseus.get_all_wisdom(limit=6)
            memory_context = _format_wisdom(recent_wisdom)
            self.logger.info("Memory: loaded cards=%s", len(recent_wisdom))

            deps = SisyphusDeps(
                repo_root=REPO_ROOT,
                logger=self.logger,
                odysseus=self.odysseus,
                trace_id=self.current_trace_id,
                memory_context=memory_context,
            )

            if self.llm is None:
                self.logger.warning("LLM unavailable; returning stub response")
                _save_agent_log(
                    self.current_trace_id, self.logger, "agent.nollm", level="WARN"
                )
                return {
                    "status": "completed",
                    "trace_id": self.current_trace_id,
                    "entropy": self.entropy.count_tokens(
                        "\n".join([instruction, memory_context])
                    ),
                    "agent_state": "NoLLM",
                    "answer": "LLM is not configured. Set DEEPSEEK_API_KEY (and optionally AOS_AGENT_MODEL) to enable the agent.",
                    "next_steps": [
                        "export DEEPSEEK_API_KEY=...",
                        "export AOS_AGENT_MODEL=deepseek:deepseek-chat",
                        "retry /api/v1/agent/task",
                    ],
                }

            try:
                _save_agent_log(
                    self.current_trace_id,
                    self.logger,
                    f"agent.start instruction={instruction}",
                )
                result = self.llm.run_sync(instruction, deps=deps)
                _save_agent_log(self.current_trace_id, self.logger, "agent.done")
            except Exception as exc:
                self.logger.exception("LLM run failed")
                _save_agent_log(
                    self.current_trace_id,
                    self.logger,
                    f"agent.error {exc}",
                    level="ERROR",
                )
                return {
                    "status": "error",
                    "trace_id": self.current_trace_id,
                    "error": str(exc),
                    "agent_state": "ERROR",
                }

            output = result.output
            entropy_tokens = self.entropy.count_tokens(
                "\n".join([instruction, memory_context, output.answer])
            )

            self.logger.info("Answer: %s", output.answer)
            if output.next_steps:
                self.logger.info("NextSteps: %s", " | ".join(output.next_steps))

            return {
                "status": "completed",
                "trace_id": self.current_trace_id,
                "entropy": entropy_tokens,
                "agent_state": "Stable",
                "answer": output.answer,
                "next_steps": output.next_steps,
            }
