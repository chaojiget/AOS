from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal, TypeAlias

import pandas as pd
import streamlit as st
from sqlalchemy import case, func
from sqlmodel import Session, select

# Hack: Ensure we can find the packages if running directly (though uv run handles this usually)
# This is a fallback for some IDEs or direct execution context
try:
    from aos_storage.db import engine
    from aos_storage.models import LogEntry, WisdomItem
    from aos_memory.entropy import EntropyService
    from aos_memory.odysseus import OdysseusService
except ImportError as e:
    st.error(f"Failed to import AOS packages: {e}")
    st.stop()

Language: TypeAlias = Literal["zh", "en"]
DEFAULT_LANGUAGE: Language = "zh"
LANGUAGE_LABELS: Mapping[Language, str] = {"zh": "中文", "en": "English"}

TRANSLATIONS: Mapping[str, Mapping[Language, str]] = {
    "language": {"zh": "语言", "en": "Language"},
    "module": {"zh": "模块", "en": "Module"},
    "sisyphus_protocol": {"zh": "西西弗协议", "en": "The Sisyphus Protocol"},
    "neural_stream": {"zh": "神经流", "en": "Neural Stream"},
    "entropy_monitor": {"zh": "熵监控", "en": "Entropy Monitor"},
    "memory_vault": {"zh": "记忆金库", "en": "Memory Vault"},
    "trace_chain": {"zh": "日志链", "en": "Trace Chain"},
    "trace_list": {"zh": "Trace 列表", "en": "Trace List"},
    "manual_trace_id": {"zh": "手动 Trace ID", "en": "Manual Trace ID"},
    "last_seen": {"zh": "最近时间", "en": "Last Seen"},
    "last_message": {"zh": "最后消息", "en": "Last Message"},
    "select_trace_hint": {"zh": "点击左侧列表选择 Trace", "en": "Pick a trace from the list"},
    "neural_stream_subtitle": {
        "zh": "实时日志：快速筛选、下钻详情、跳转 Trace 日志链。",
        "en": "Real-time logs with quick filters, drill-down details, and trace chain jump.",
    },
    "entropy_monitor_subtitle": {
        "zh": "上下文压力与系统焦虑信号。",
        "en": "Context pressure and system anxiety signals.",
    },
    "memory_vault_subtitle": {
        "zh": "从历史 Trace 会话中蒸馏的长期智慧。",
        "en": "Long-term wisdom distilled from past lives (Trace Sessions).",
    },
    "trace_chain_subtitle": {
        "zh": "以 Span 树展开同一 Trace 的完整日志链。",
        "en": "Explore the full log chain as a span tree.",
    },
    "view_mode": {"zh": "视图", "en": "View"},
    "view_tree": {"zh": "树", "en": "Tree"},
    "view_flat": {"zh": "列表", "en": "Flat"},
    "view_list": {"zh": "展开", "en": "Expandable"},
    "view_table": {"zh": "表格", "en": "Table"},
    "log_id": {"zh": "日志 ID", "en": "Log ID"},
    "log_list": {"zh": "日志列表", "en": "Log List"},
    "clear_focus": {"zh": "清除定位", "en": "Clear focus"},
    "span_id": {"zh": "Span ID", "en": "Span ID"},
    "parent_span_id": {"zh": "Parent Span ID", "en": "Parent Span ID"},
    "span_name": {"zh": "Span 名称", "en": "Span Name"},
    "unscoped_logs": {"zh": "未绑定 Span 的日志", "en": "Logs without span"},
    "errors_only": {"zh": "仅显示错误", "en": "Errors only"},
    "auto_expand_errors": {"zh": "自动展开错误", "en": "Auto-expand errors"},
    "unknown_span": {"zh": "未知 Span", "en": "Unknown Span"},
    "search": {"zh": "搜索", "en": "Search"},
    "search_placeholder": {"zh": "消息/Trace/Logger/属性…", "en": "Message / Trace / Logger / Attributes…"},
    "level": {"zh": "级别", "en": "Level"},
    "refresh": {"zh": "刷新", "en": "Refresh"},
    "no_logs": {"zh": "日志流暂无数据。", "en": "No logs found in the memory stream."},
    "recent_entries": {"zh": "最近条目", "en": "Recent Entries"},
    "errors_last_100": {"zh": "错误数（最近 100）", "en": "Errors (Last 100)"},
    "entries": {"zh": "条目数", "en": "Entries"},
    "errors": {"zh": "错误数", "en": "Errors"},
    "active_traces": {"zh": "活跃 Trace", "en": "Active Traces"},
    "log_details": {"zh": "日志详情", "en": "Log Details"},
    "time": {"zh": "时间", "en": "Time"},
    "logger": {"zh": "Logger", "en": "Logger"},
    "trace_id": {"zh": "Trace ID", "en": "Trace ID"},
    "message": {"zh": "消息", "en": "Message"},
    "attributes_traceback": {"zh": "属性 / 堆栈", "en": "Attributes / Traceback"},
    "open_trace_chain": {"zh": "打开日志链", "en": "Open Trace Chain"},
    "trace_id_unavailable": {"zh": "该日志没有 Trace ID，无法跳转。", "en": "This log has no Trace ID; cannot jump."},
    "trace_chain_input_placeholder": {"zh": "输入 Trace ID…", "en": "Paste a Trace ID…"},
    "load": {"zh": "加载", "en": "Load"},
    "trace_chain_empty": {"zh": "该 Trace 暂无日志或已被清理。", "en": "No logs for this trace (or they were purged)."},
    "back_to_stream": {"zh": "返回神经流", "en": "Back to Neural Stream"},
    "state_of_sisyphus": {"zh": "西西弗状态", "en": "The State of Sisyphus"},
    "refresh_physics": {"zh": "刷新指标", "en": "Refresh Physics"},
    "no_data": {"zh": "暂无数据可分析。", "en": "No data to analyze."},
    "token_entropy": {"zh": "Token 熵", "en": "Token Entropy"},
    "anxiety_level": {"zh": "焦虑水平", "en": "Anxiety Level"},
    "status": {"zh": "状态", "en": "Status"},
    "healthy": {"zh": "健康", "en": "HEALTHY"},
    "critical_reset": {"zh": "危急（即将重置）", "en": "CRITICAL (RESET IMMINENT)"},
    "anxious": {"zh": "焦虑", "en": "ANXIOUS"},
    "context_pressure": {"zh": "上下文压力（熵）", "en": "Context Pressure (Entropy)"},
    "anxiety_error_rate": {"zh": "焦虑（错误率）", "en": "Anxiety (Error Rate)"},
    "laboratory": {"zh": "实验室", "en": "Laboratory"},
    "simulate_panic": {"zh": "模拟恐慌（注入错误）", "en": "Simulate Panic (Inject Errors)"},
    "simulate_bloat": {"zh": "模拟上下文膨胀", "en": "Simulate Context Bloat"},
    "search_wisdom_placeholder": {"zh": "关键词或 #标签…", "en": "Keywords or #tags…"},
    "manual_distillation": {"zh": "手动蒸馏（测试）", "en": "Manual Distillation (Test)"},
    "trace_id_to_distill": {"zh": "要蒸馏的 Trace ID", "en": "Trace ID to Distill"},
    "distill_trace": {"zh": "蒸馏 Trace", "en": "Distill Trace"},
    "odysseus_analyzing": {"zh": "Odysseus 正在分析…", "en": "Odysseus is analyzing..."},
    "wisdom_extracted": {"zh": "已提取智慧", "en": "Wisdom Extracted"},
    "trace_not_found": {"zh": "Trace 不存在或为空。", "en": "Trace not found or empty."},
    "enter_trace_id": {"zh": "请输入 Trace ID。", "en": "Please enter a Trace ID."},
    "vault_empty": {
        "zh": "金库还是空的：西西弗还没学会什么……或还没死够。",
        "en": "The Vault is empty. Sisyphus hasn't learned anything yet... or hasn't died enough.",
    },
    "view_source_trace": {"zh": "查看来源 Trace", "en": "View Source Trace"},
    "level_info": {"zh": "信息", "en": "Info"},
    "level_warning": {"zh": "警告", "en": "Warning"},
    "level_error": {"zh": "错误", "en": "Error"},
}


def get_language() -> Language:
    lang = st.session_state.get("lang")
    if lang in LANGUAGE_LABELS:
        return lang
    return DEFAULT_LANGUAGE


def t(key: str) -> str:
    table = TRANSLATIONS.get(key)
    if not table:
        return key
    lang = get_language()
    return table.get(lang, table.get(DEFAULT_LANGUAGE, key))


def format_level(level: str | None) -> str:
    if level == "INFO":
        return t("level_info")
    if level == "WARNING":
        return t("level_warning")
    if level == "ERROR":
        return t("level_error")
    return str(level) if level else "N/A"


def normalize_id(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan" or text == "N/A":
        return None
    return text


def parse_attributes(attributes_value: object) -> dict[str, Any] | None:
    if attributes_value is None:
        return None
    if isinstance(attributes_value, float) and pd.isna(attributes_value):
        return None
    text = str(attributes_value).strip()
    if not text or text.lower() == "nan":
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def extract_otel_meta(attributes: dict[str, Any] | None) -> tuple[str | None, str | None, str | None]:
    if not attributes:
        return None, None, None
    otel = attributes.get("otel")
    if not isinstance(otel, dict):
        return None, None, None

    span_id = normalize_id(otel.get("span_id"))
    parent_span_id = normalize_id(otel.get("parent_span_id"))
    span_name = otel.get("span_name")
    span_name_text = str(span_name).strip() if span_name else None
    return span_id, parent_span_id, span_name_text or None


@dataclass
class TraceSpanNode:
    span_id: str
    name: str
    parent_span_id: str | None = None
    logs: list[dict[str, Any]] = field(default_factory=list)
    children: list["TraceSpanNode"] = field(default_factory=list)
    start_time: datetime | None = None
    total_logs: int = 0
    error_logs: int = 0
    contains_focus: bool = False


def build_trace_span_tree(
    df_chain: pd.DataFrame,
    *,
    focus_log_id: int | None,
) -> tuple[list[TraceSpanNode], list[dict[str, Any]]]:
    nodes: dict[str, TraceSpanNode] = {}
    unscoped_logs: list[dict[str, Any]] = []

    for _, row in df_chain.iterrows():
        log_dict = row.to_dict()
        span_id = normalize_id(log_dict.get("Span ID"))

        attributes = parse_attributes(log_dict.get("Attributes"))
        span_id_from_attr, parent_span_id, span_name = extract_otel_meta(attributes)
        span_id = span_id or span_id_from_attr

        if span_id is None:
            unscoped_logs.append(log_dict)
            continue

        node = nodes.get(span_id)
        if node is None:
            node = TraceSpanNode(
                span_id=span_id,
                name=span_name or span_id,
                parent_span_id=parent_span_id,
            )
            nodes[span_id] = node
        else:
            if node.parent_span_id is None and parent_span_id:
                node.parent_span_id = parent_span_id
            if (not node.name or node.name == node.span_id) and span_name:
                node.name = span_name

        time_value = log_dict.get("Time")
        if time_value and (node.start_time is None or time_value < node.start_time):
            node.start_time = time_value

        node.logs.append(log_dict)

    for node in list(nodes.values()):
        parent_span_id = node.parent_span_id
        if parent_span_id and parent_span_id not in nodes and parent_span_id != node.span_id:
            nodes[parent_span_id] = TraceSpanNode(
                span_id=parent_span_id,
                name=f"{t('unknown_span')} · {parent_span_id[:8]}",
            )

    roots: list[TraceSpanNode] = []
    for node in nodes.values():
        parent_span_id = node.parent_span_id
        if parent_span_id and parent_span_id in nodes and parent_span_id != node.span_id:
            parent = nodes[parent_span_id]
            parent.children.append(node)
            if node.start_time and (parent.start_time is None or node.start_time < parent.start_time):
                parent.start_time = node.start_time
        else:
            roots.append(node)

    def sort_node(node: TraceSpanNode) -> None:
        node.children.sort(key=lambda child: child.start_time or datetime.min)
        for child in node.children:
            sort_node(child)

    roots.sort(key=lambda node: node.start_time or datetime.min)
    for root in roots:
        sort_node(root)

    def compute_aggregates(node: TraceSpanNode) -> tuple[int, int, bool]:
        total = len(node.logs)
        errors = sum(1 for log in node.logs if log.get("Level") == "ERROR")

        contains_focus = False
        if focus_log_id is not None:
            contains_focus = any(log.get("id") == focus_log_id for log in node.logs)

        for child in node.children:
            child_total, child_errors, child_contains_focus = compute_aggregates(child)
            total += child_total
            errors += child_errors
            contains_focus = contains_focus or child_contains_focus

        node.total_logs = total
        node.error_logs = errors
        node.contains_focus = contains_focus
        return total, errors, contains_focus

    for root in roots:
        compute_aggregates(root)

    return roots, unscoped_logs


def render_log_expander(
    log: Mapping[str, Any],
    *,
    expanded: bool,
    show_open_trace_chain: bool = False,
    open_trace_chain_key: str | None = None,
) -> None:
    level = str(log.get("Level") or "INFO")
    icon = "ℹ️"
    if level == "WARNING":
        icon = "⚠️"
    elif level == "ERROR":
        icon = "🔥"

    time_value = log.get("Time")
    time_label = time_value.strftime("%H:%M:%S") if hasattr(time_value, "strftime") else str(time_value)
    logger_value = log.get("Logger", "")
    message_value = str(log.get("Message", ""))
    summary = f"{icon} [{time_label}] {format_level(level)} · {logger_value} — {message_value[:90]}"

    with st.expander(summary, expanded=expanded):
        attributes_value = log.get("Attributes")
        attributes = parse_attributes(attributes_value)
        span_id_from_attr, parent_span_id, span_name = extract_otel_meta(attributes)
        span_id_value = normalize_id(log.get("Span ID")) or span_id_from_attr or "N/A"

        meta1, meta2, meta3, meta4 = st.columns([1.1, 1.1, 1.6, 2.2])
        meta1.caption(f"{t('time')}: `{time_value}`")
        meta2.caption(f"{t('level')}: `{format_level(level)}`")
        meta3.caption(f"{t('trace_id')}: `{log.get('Trace ID', 'N/A')}`")
        meta4.caption(f"{t('span_id')}: `{span_id_value}`")
        if span_name:
            st.caption(f"{t('span_name')}: `{span_name}`")
        if parent_span_id:
            st.caption(f"{t('parent_span_id')}: `{parent_span_id}`")

        st.caption(f"{t('logger')}: `{logger_value}`")
        st.code(message_value, language="text")

        if show_open_trace_chain:
            trace_id = normalize_id(log.get("Trace ID"))
            log_id = log.get("id")
            focus_log_id = log_id if isinstance(log_id, int) else None
            key = open_trace_chain_key
            if key is None:
                key = f"open_trace_chain_{trace_id}_{focus_log_id}"
            if st.button(
                t("open_trace_chain"),
                key=key,
                use_container_width=True,
                disabled=trace_id is None,
            ):
                jump_to_trace_chain(trace_id, focus_log_id=focus_log_id)

        if attributes_value:
            with st.expander(t("attributes_traceback"), expanded=(level == "ERROR")):
                if attributes is not None:
                    st.json(attributes)
                else:
                    st.text(str(attributes_value))


def render_span_node(
    node: TraceSpanNode,
    *,
    errors_only: bool,
    auto_expand_errors: bool,
    focus_log_id: int | None,
) -> None:
    if errors_only and node.error_logs == 0:
        return

    label = f"{node.name} · {node.total_logs} · {node.error_logs}E"
    expanded = False
    if focus_log_id is not None and node.contains_focus:
        expanded = True
    elif auto_expand_errors and node.error_logs > 0:
        expanded = True

    with st.expander(label, expanded=expanded):
        parent_label = node.parent_span_id or "N/A"
        st.caption(f"{t('span_id')}: `{node.span_id}` · {t('parent_span_id')}: `{parent_label}`")

        logs = node.logs
        if errors_only:
            logs = [log for log in logs if log.get("Level") == "ERROR"]
        for log in logs:
            log_expanded = False
            if focus_log_id is not None and log.get("id") == focus_log_id:
                log_expanded = True
            elif auto_expand_errors and log.get("Level") == "ERROR":
                log_expanded = True
            render_log_expander(log, expanded=log_expanded)

        for child in node.children:
            render_span_node(
                child,
                errors_only=errors_only,
                auto_expand_errors=auto_expand_errors,
                focus_log_id=focus_log_id,
            )


def render_hero(icon: str, title: str, subtitle: str) -> None:
    st.markdown(
        f"""
        <div class="aos-hero">
          <div class="aos-hero-icon">{icon}</div>
          <div>
            <div class="aos-hero-title">{title}</div>
            <div class="aos-hero-subtitle">{subtitle}</div>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


# Page Config
st.set_page_config(
    page_title="AOS Consciousness Viewer",
    page_icon="🧠",
    layout="wide",
    initial_sidebar_state="expanded",
)

def apply_glassmorphism_theme() -> None:
    st.markdown(
        """
        <style>
        :root {
          --aos-bg: radial-gradient(1200px 800px at 15% 10%, rgba(124, 58, 237, 0.35), transparent 60%),
                    radial-gradient(1000px 700px at 85% 20%, rgba(59, 130, 246, 0.25), transparent 55%),
                    radial-gradient(900px 650px at 50% 95%, rgba(16, 185, 129, 0.18), transparent 55%),
                    linear-gradient(180deg, rgba(2, 6, 23, 1) 0%, rgba(10, 12, 25, 1) 65%, rgba(2, 6, 23, 1) 100%);

          --aos-glass: rgba(255, 255, 255, 0.06);
          --aos-glass-2: rgba(255, 255, 255, 0.08);
          --aos-border: rgba(255, 255, 255, 0.12);
          --aos-border-2: rgba(255, 255, 255, 0.16);
          --aos-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
          --aos-shadow-soft: 0 8px 20px rgba(0, 0, 0, 0.18);
          --aos-radius: 16px;
        }

        [data-testid="stAppViewContainer"] {
          background: var(--aos-bg);
        }

        [data-testid="stHeader"] {
          background: transparent;
        }

        .block-container {
          max-width: 1200px;
          padding-top: 2.25rem;
          padding-bottom: 3rem;
        }

        @media (max-width: 768px) {
          .block-container {
            padding-top: 1.25rem;
            padding-left: 1rem;
            padding-right: 1rem;
          }
        }

        /* Sidebar */
        [data-testid="stSidebar"] > div:first-child {
          background: rgba(2, 6, 23, 0.35);
          border-right: 1px solid var(--aos-border);
          -webkit-backdrop-filter: blur(14px);
          backdrop-filter: blur(14px);
        }

        /* Cards (border=True containers), expanders, and metrics */
        [data-testid="stVerticalBlockBorderWrapper"],
        div[data-testid="stExpander"],
        div[data-testid="metric-container"] {
          background: var(--aos-glass);
          border: 1px solid var(--aos-border);
          border-radius: var(--aos-radius);
          box-shadow: var(--aos-shadow-soft);
          -webkit-backdrop-filter: blur(12px);
          backdrop-filter: blur(12px);
        }

        div[data-testid="metric-container"] {
          padding: 14px 16px;
        }

        div[data-testid="stExpander"] summary {
          padding: 14px 16px;
        }

        /* Buttons */
        div[data-testid="stButton"] > button {
          border-radius: 999px !important;
          border: 1px solid var(--aos-border) !important;
          background: var(--aos-glass-2);
          box-shadow: var(--aos-shadow-soft);
        }

        /* Inputs */
        div[data-testid="stTextInput"] input,
        div[data-testid="stTextArea"] textarea,
        div[data-testid="stSelectbox"] div,
        div[data-testid="stMultiSelect"] div {
          border-radius: 14px !important;
          border: 1px solid var(--aos-border) !important;
          background: rgba(2, 6, 23, 0.35) !important;
        }

        /* Dataframe */
        div[data-testid="stDataFrame"] {
          background: var(--aos-glass);
          border: 1px solid var(--aos-border);
          border-radius: var(--aos-radius);
          box-shadow: var(--aos-shadow);
          overflow: hidden;
          -webkit-backdrop-filter: blur(12px);
          backdrop-filter: blur(12px);
        }

        /* Code blocks */
        pre {
          border-radius: 14px !important;
          border: 1px solid var(--aos-border);
          background: rgba(2, 6, 23, 0.55) !important;
        }

        /* Headings */
        h1, h2, h3 {
          letter-spacing: -0.02em;
        }

        .aos-hero {
          display: flex;
          gap: 14px;
          align-items: center;
          padding: 16px 18px;
          border-radius: var(--aos-radius);
          border: 1px solid var(--aos-border);
          background: rgba(255, 255, 255, 0.06);
          box-shadow: var(--aos-shadow);
          -webkit-backdrop-filter: blur(12px);
          backdrop-filter: blur(12px);
          margin-bottom: 14px;
        }

        .aos-hero-icon {
          font-size: 22px;
          line-height: 1;
          width: 40px;
          height: 40px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          border: 1px solid var(--aos-border-2);
          background: rgba(255, 255, 255, 0.06);
        }

        .aos-hero-title {
          font-size: 1.1rem;
          font-weight: 650;
          margin: 0;
        }

        .aos-hero-subtitle {
          margin-top: 2px;
          opacity: 0.8;
          font-size: 0.92rem;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


apply_glassmorphism_theme()

# Initialize Services
entropy_service = EntropyService()
odysseus_service = OdysseusService()

# --- Sidebar ---
st.session_state.setdefault("lang", DEFAULT_LANGUAGE)
st.session_state.setdefault("module", "neural_stream")
st.session_state.setdefault("trace_chain_trace_id", "")
st.session_state.setdefault("trace_chain_view_mode", "tree")
st.session_state.setdefault("trace_chain_errors_only", False)
st.session_state.setdefault("trace_chain_auto_expand_errors", True)
st.session_state.setdefault("trace_chain_focus_log_id", None)
st.session_state.setdefault("neural_stream_view_mode", "list")
st.session_state.setdefault("neural_stream_auto_expand_errors", True)

MODULES: tuple[str, ...] = ("neural_stream", "trace_chain", "entropy_monitor", "memory_vault")
MODULE_ICONS: Mapping[str, str] = {
    "neural_stream": "🧠",
    "trace_chain": "🧵",
    "entropy_monitor": "📉",
    "memory_vault": "🏛️",
}


def module_label(module: str) -> str:
    icon = MODULE_ICONS.get(module, "•")
    return f"{icon} {t(module)}"


def jump_to_trace_chain(trace_id: str | None, *, focus_log_id: int | None = None) -> None:
    if not trace_id or trace_id == "N/A":
        st.warning(t("trace_id_unavailable"))
        return

    st.session_state["trace_chain_trace_id"] = trace_id
    st.session_state["trace_chain_focus_log_id"] = focus_log_id
    st.session_state["module"] = "trace_chain"
    st.rerun()


with st.sidebar:
    with st.container(border=True):
        st.markdown("### AOS v0.2")
        st.caption(t("sisyphus_protocol"))

    st.selectbox(
        f"{t('language')} / Language",
        options=list(LANGUAGE_LABELS.keys()),
        key="lang",
        format_func=lambda lang: LANGUAGE_LABELS[lang],
    )

    page = st.radio(
        t("module"),
        options=MODULES,
        key="module",
        format_func=module_label,
    )

# --- Database Helper ---
@st.cache_data(ttl=2)  # Auto-refresh every 2 seconds
def fetch_logs():
    with Session(engine) as session:
        statement = select(LogEntry).order_by(LogEntry.timestamp.desc()).limit(100)
        results = session.exec(statement).all()
        data = [
            {
                "id": r.id,
                "Time": r.timestamp, 
                "Level": r.level, 
                "Logger": r.logger_name, 
                "Message": r.message,
                "Trace ID": r.trace_id if r.trace_id else "N/A",
                "Span ID": r.span_id if r.span_id else "N/A",
                "Attributes": r.attributes
            }
            for r in results
        ]
        return pd.DataFrame(data)

@st.cache_data(ttl=2)
def fetch_recent_traces(limit: int = 80) -> pd.DataFrame:
    with Session(engine) as session:
        summary_stmt = (
            select(
                LogEntry.trace_id,
                func.count(LogEntry.id).label("entries"),
                func.sum(case((LogEntry.level == "ERROR", 1), else_=0)).label("errors"),
                func.max(LogEntry.timestamp).label("last_time"),
            )
            .where(LogEntry.trace_id.is_not(None))
            .group_by(LogEntry.trace_id)
            .order_by(func.max(LogEntry.timestamp).desc())
            .limit(limit)
        )
        summary_rows = session.exec(summary_stmt).all()

        traces: list[dict[str, Any]] = []
        for trace_id, entries, errors, last_time in summary_rows:
            last_stmt = (
                select(
                    LogEntry.timestamp,
                    LogEntry.logger_name,
                    LogEntry.message,
                    LogEntry.attributes,
                    LogEntry.span_id,
                )
                .where(LogEntry.trace_id == trace_id)
                .order_by(LogEntry.timestamp.desc())
                .limit(1)
            )
            last_row = session.exec(last_stmt).first()
            last_logger = last_row[1] if last_row else ""
            last_message = last_row[2] if last_row else ""
            last_attributes = last_row[3] if last_row else None
            last_span_id = last_row[4] if last_row else None

            span_id_from_attr = None
            span_name = None
            attributes = parse_attributes(last_attributes)
            span_id_from_attr, _, span_name = extract_otel_meta(attributes)

            traces.append(
                {
                    "Trace ID": trace_id,
                    "Last Time": last_time,
                    "Entries": int(entries or 0),
                    "Errors": int(errors or 0),
                    "Last Logger": last_logger,
                    "Last Message": last_message,
                    "Span ID": last_span_id or span_id_from_attr or None,
                    "Span Name": span_name or None,
                }
            )

        return pd.DataFrame(traces)

@st.cache_data(ttl=2)
def fetch_trace_chain(trace_id: str) -> pd.DataFrame:
    with Session(engine) as session:
        statement = (
            select(LogEntry)
            .where(LogEntry.trace_id == trace_id)
            .order_by(LogEntry.timestamp)
        )
        results = session.exec(statement).all()
        data = [
            {
                "id": r.id,
                "Time": r.timestamp,
                "Level": r.level,
                "Logger": r.logger_name,
                "Message": r.message,
                "Trace ID": r.trace_id if r.trace_id else "N/A",
                "Span ID": r.span_id if r.span_id else "N/A",
                "Attributes": r.attributes,
            }
            for r in results
        ]
        return pd.DataFrame(data)

# --- Neural Stream Page ---
if page == "neural_stream":
    render_hero("🧠", t("neural_stream"), t("neural_stream_subtitle"))
    
    with st.container(border=True):
        filter_col1, filter_col2, filter_col3 = st.columns([3, 1.2, 1])
        search_term = filter_col1.text_input(
            t("search"),
            placeholder=t("search_placeholder"),
            label_visibility="collapsed",
        )
        level_filter = filter_col2.multiselect(
            t("level"),
            options=["INFO", "WARNING", "ERROR"],
            default=["INFO", "WARNING", "ERROR"],
            format_func=lambda level: {
                "INFO": t("level_info"),
                "WARNING": t("level_warning"),
                "ERROR": t("level_error"),
            }.get(level, str(level)),
        )

        if filter_col3.button(t("refresh"), use_container_width=True):
            fetch_logs.clear()

    df = fetch_logs()
    
    if df.empty:
        st.info(t("no_logs"))
    else:
        df = df[df["Level"].isin(level_filter)]
        df = df.reset_index(drop=True)

        if search_term:
            message_col = df["Message"].astype(str)
            trace_col = df["Trace ID"].astype(str)
            logger_col = df["Logger"].astype(str)
            attr_col = df["Attributes"].fillna("").astype(str)
            df = df[
                message_col.str.contains(search_term, case=False, na=False)
                | trace_col.str.contains(search_term, case=False, na=False)
                | logger_col.str.contains(search_term, case=False, na=False)
                | attr_col.str.contains(search_term, case=False, na=False)
            ]
            df = df.reset_index(drop=True)

        # Metrics / Quick Stats
        col1, col2, col3 = st.columns(3)
        total_logs = df.shape[0]
        error_count = df[df["Level"] == "ERROR"].shape[0]
        active_traces = df["Trace ID"].nunique()
        
        col1.metric(t("recent_entries"), total_logs)
        col2.metric(t("errors_last_100"), error_count, delta_color="inverse")
        col3.metric(t("active_traces"), active_traces)

        st.divider()

        view_col1, view_col2 = st.columns([1.6, 1.2])
        view_mode = view_col1.segmented_control(
            t("view_mode"),
            options=["list", "table"],
            key="neural_stream_view_mode",
            format_func=lambda mode: t("view_list") if mode == "list" else t("view_table"),
            label_visibility="collapsed",
        )
        auto_expand_errors = view_col2.checkbox(
            t("auto_expand_errors"),
            key="neural_stream_auto_expand_errors",
        )

        if view_mode == "list":
            for log in df.to_dict(orient="records"):
                render_log_expander(
                    log,
                    expanded=bool(auto_expand_errors and log.get("Level") == "ERROR"),
                    show_open_trace_chain=True,
                    open_trace_chain_key=f"ns_open_trace_chain_{log.get('id')}",
                )
        else:
            level_display_map = {
                "INFO": t("level_info"),
                "WARNING": t("level_warning"),
                "ERROR": t("level_error"),
            }

            df_view = pd.DataFrame(
                {
                    "Time": df["Time"].apply(lambda dt: dt.strftime("%H:%M:%S")),
                    "Level": df["Level"].map(level_display_map).fillna(df["Level"]),
                    "Logger": df["Logger"],
                    "Message": df["Message"].astype(str).str.slice(0, 160),
                    "Trace ID": df["Trace ID"],
                }
            )

            event = st.dataframe(
                df_view,
                hide_index=True,
                use_container_width=True,
                height=520,
                on_select="rerun",
                selection_mode="single-row",
                column_config={
                    "Time": st.column_config.TextColumn(t("time"), width="small"),
                    "Level": st.column_config.TextColumn(t("level"), width="small"),
                    "Logger": st.column_config.TextColumn(t("logger"), width="medium"),
                    "Message": st.column_config.TextColumn(t("message"), width="large"),
                    "Trace ID": st.column_config.TextColumn(t("trace_id"), width="medium"),
                },
            )

            selected_row = None
            if hasattr(event, "selection") and event.selection.rows:
                selected_row = df.iloc[event.selection.rows[0]].to_dict()

            if selected_row:
                with st.container(border=True):
                    st.subheader(t("log_details"))
                    meta1, meta2, meta3, meta4 = st.columns([1.1, 1, 1.4, 2])
                    meta1.caption(f"{t('time')}: `{selected_row['Time']}`")
                    meta2.caption(f"{t('level')}: `{format_level(selected_row['Level'])}`")
                    meta3.caption(f"{t('trace_id')}: `{selected_row['Trace ID']}`")
                    meta4.caption(f"{t('logger')}: `{selected_row['Logger']}`")
                    st.caption(f"{t('span_id')}: `{selected_row.get('Span ID', 'N/A')}`")

                    st.code(selected_row["Message"], language="text")
                    trace_id = selected_row.get("Trace ID")
                    focus_log_id = selected_row.get("id")
                    if st.button(
                        t("open_trace_chain"),
                        use_container_width=True,
                        disabled=(not trace_id or trace_id == "N/A"),
                    ):
                        jump_to_trace_chain(
                            trace_id,
                            focus_log_id=focus_log_id if isinstance(focus_log_id, int) else None,
                        )

                    if selected_row.get("Attributes"):
                        with st.expander(
                            t("attributes_traceback"),
                            expanded=(selected_row.get("Level") == "ERROR"),
                        ):
                            parsed = parse_attributes(selected_row.get("Attributes"))
                            if parsed is not None:
                                st.json(parsed)
                            else:
                                st.text(str(selected_row.get("Attributes")))

# --- Trace Chain ---
elif page == "trace_chain":
    render_hero("🧵", t("trace_chain"), t("trace_chain_subtitle"))

    with st.container(border=True):
        header_col1, header_col2 = st.columns([3, 1])
        header_col1.subheader(t("trace_list"))
        if header_col2.button(t("refresh"), use_container_width=True, key="trace_chain_refresh_traces"):
            fetch_recent_traces.clear()

        traces_df = fetch_recent_traces()
        if not traces_df.empty:
            trace_records = traces_df.to_dict(orient="records")
            trace_view = pd.DataFrame(
                {
                    "Last": traces_df["Last Time"].apply(
                        lambda dt: dt.strftime("%Y-%m-%d %H:%M:%S") if hasattr(dt, "strftime") else str(dt)
                    ),
                    "Errors": traces_df["Errors"],
                    "Entries": traces_df["Entries"],
                    "Span": traces_df["Span Name"]
                    .fillna(traces_df["Span ID"].fillna(""))
                    .astype(str)
                    .str.slice(0, 40),
                    "Message": traces_df["Last Message"].astype(str).str.slice(0, 80),
                    "Trace ID": traces_df["Trace ID"].astype(str),
                }
            )

            trace_event = st.dataframe(
                trace_view,
                key="trace_chain_trace_list",
                hide_index=True,
                use_container_width=True,
                height=220,
                on_select="rerun",
                selection_mode="single-row",
                column_config={
                    "Last": st.column_config.TextColumn(t("last_seen"), width="medium"),
                    "Errors": st.column_config.TextColumn(t("errors"), width="small"),
                    "Entries": st.column_config.TextColumn(t("entries"), width="small"),
                    "Span": st.column_config.TextColumn(t("span_name"), width="medium"),
                    "Message": st.column_config.TextColumn(t("last_message"), width="large"),
                    "Trace ID": st.column_config.TextColumn(t("trace_id"), width="medium", max_chars=36),
                },
            )

            if hasattr(trace_event, "selection") and trace_event.selection.rows:
                selected_index = trace_event.selection.rows[0]
                selected_trace_id = trace_records[selected_index].get("Trace ID")
                if isinstance(selected_trace_id, str) and selected_trace_id.strip():
                    st.session_state["trace_chain_trace_id"] = selected_trace_id.strip()
                    st.session_state["trace_chain_focus_log_id"] = None
                    fetch_trace_chain.clear()

        st.divider()
        c1, c2, c3 = st.columns([3, 1, 1.2])
        current_trace_id = str(st.session_state.get("trace_chain_trace_id", "")).strip()
        c1.caption(f"{t('trace_id')}: `{current_trace_id or '—'}`")
        if c2.button(t("load"), use_container_width=True, disabled=not current_trace_id, key="trace_chain_load"):
            fetch_trace_chain.clear()
        if c3.button(t("back_to_stream"), use_container_width=True, key="trace_chain_back"):
            st.session_state["module"] = "neural_stream"
            st.rerun()

        with st.expander(t("manual_trace_id"), expanded=False):
            manual_col1, manual_col2 = st.columns([3, 1])
            manual_trace_id = manual_col1.text_input(
                t("trace_id"),
                key="trace_chain_trace_id_manual",
                value=current_trace_id,
                label_visibility="collapsed",
                placeholder=t("trace_chain_input_placeholder"),
            )
            if manual_col2.button(
                t("load"),
                use_container_width=True,
                disabled=not manual_trace_id.strip(),
                key="trace_chain_load_manual",
            ):
                st.session_state["trace_chain_trace_id"] = manual_trace_id.strip()
                st.session_state["trace_chain_focus_log_id"] = None
                fetch_trace_chain.clear()

        view_col1, view_col2, view_col3, view_col4 = st.columns([1.6, 1, 1.2, 1])
        view_mode = view_col1.segmented_control(
            t("view_mode"),
            options=["tree", "flat"],
            key="trace_chain_view_mode",
            format_func=lambda mode: t("view_tree") if mode == "tree" else t("view_flat"),
            label_visibility="collapsed",
        )
        errors_only = view_col2.checkbox(t("errors_only"), key="trace_chain_errors_only")
        auto_expand_errors = view_col3.checkbox(
            t("auto_expand_errors"),
            key="trace_chain_auto_expand_errors",
        )
        focus_id = st.session_state.get("trace_chain_focus_log_id")
        focus_id_int = focus_id if isinstance(focus_id, int) else None
        if focus_id_int is not None:
            view_col4.caption(f"{t('log_id')}: `{focus_id_int}`")
        if view_col4.button(
            t("clear_focus"),
            use_container_width=True,
            disabled=focus_id_int is None,
            key="trace_chain_clear_focus",
        ):
            st.session_state["trace_chain_focus_log_id"] = None

    trace_id = str(st.session_state.get("trace_chain_trace_id", "")).strip()
    if not trace_id:
        st.info(f"{t('trace_id')}: {t('trace_chain_input_placeholder')}")
    else:
        df_chain = fetch_trace_chain(trace_id)
        if df_chain.empty:
            st.warning(t("trace_chain_empty"))
        else:
            df_chain = df_chain.reset_index(drop=True)
            entries = int(df_chain.shape[0])
            errors = int(df_chain[df_chain["Level"] == "ERROR"].shape[0])
            col_a, col_b, col_c = st.columns(3)
            col_a.metric(t("entries"), entries)
            col_b.metric(t("errors"), errors, delta_color="inverse")
            col_c.metric(t("trace_id"), trace_id)

            st.divider()
            focus_id = st.session_state.get("trace_chain_focus_log_id")
            focus_log_id_int = focus_id if isinstance(focus_id, int) else None

            if view_mode == "tree":
                roots, unscoped_logs = build_trace_span_tree(df_chain, focus_log_id=focus_log_id_int)
                for root in roots:
                    render_span_node(
                        root,
                        errors_only=bool(errors_only),
                        auto_expand_errors=bool(auto_expand_errors),
                        focus_log_id=focus_log_id_int,
                    )

                visible_unscoped = (
                    [log for log in unscoped_logs if log.get("Level") == "ERROR"]
                    if errors_only
                    else unscoped_logs
                )
                if visible_unscoped:
                    should_expand_unscoped = bool(
                        (focus_log_id_int is not None and any(log.get("id") == focus_log_id_int for log in visible_unscoped))
                        or (auto_expand_errors and any(log.get("Level") == "ERROR" for log in visible_unscoped))
                    )
                    with st.expander(t("unscoped_logs"), expanded=should_expand_unscoped):
                        for log in visible_unscoped:
                            render_log_expander(
                                log,
                                expanded=bool(
                                    (focus_log_id_int is not None and log.get("id") == focus_log_id_int)
                                    or (auto_expand_errors and log.get("Level") == "ERROR")
                                ),
                            )
            else:
                for log in df_chain.to_dict(orient="records"):
                    if errors_only and log.get("Level") != "ERROR":
                        continue
                    render_log_expander(
                        log,
                        expanded=bool(
                            (focus_log_id_int is not None and log.get("id") == focus_log_id_int)
                            or (auto_expand_errors and log.get("Level") == "ERROR")
                        ),
                    )

# --- Entropy Monitor ---
elif page == "entropy_monitor":
    render_hero("📉", t("entropy_monitor"), t("entropy_monitor_subtitle"))
    
    st.markdown(f"### {t('state_of_sisyphus')}")
    
    # Refresh logic similar to logs
    if st.button(t("refresh_physics")):
        fetch_logs.clear()
        
    df = fetch_logs()
    
    if df.empty:
        st.warning(t("no_data"))
    else:
        # 1. Calculate Current Entropy (Simulated based on last message size + buffer)
        # In a real agent, this would be the actual conversation history size.
        # Here we simulate accumulation from the logs.
        combined_text = " ".join(df["Message"].tolist())
        current_tokens = entropy_service.count_tokens(combined_text)
        max_tokens = entropy_service.MAX_TOKENS
        
        # 2. Calculate Anxiety
        # Convert df back to LogEntry objects for the service (simplified)
        recent_log_entries = [
            LogEntry(level=row["Level"], message=row["Message"]) 
            for _, row in df.head(20).iterrows()
        ]
        anxiety_score = entropy_service.calculate_anxiety(recent_log_entries)
        
        # 3. Decision
        should_reset = entropy_service.should_reset(current_tokens, recent_log_entries)
        
        # --- Visualization ---
        
        # Top Metrics
        c1, c2, c3 = st.columns(3)
        c1.metric(t("token_entropy"), f"{current_tokens} / {max_tokens}", f"{current_tokens/max_tokens:.1%}")
        c2.metric(t("anxiety_level"), f"{anxiety_score:.2f}", delta_color="inverse")
        
        status_color = "green"
        status_text = t("healthy")
        if should_reset:
            status_color = "red"
            status_text = t("critical_reset")
        elif anxiety_score > 0.5:
            status_color = "orange"
            status_text = t("anxious")
            
        c3.markdown(f"**{t('status')}**: :{status_color}[{status_text}]")
        
        # Visual Bars
        st.caption(t("context_pressure"))
        st.progress(min(current_tokens / max_tokens, 1.0))
        
        st.caption(t("anxiety_error_rate"))
        st.progress(anxiety_score)
        
        # Mock Tools
        st.divider()
        st.subheader(f"🧪 {t('laboratory')}")
        c_mock1, c_mock2 = st.columns(2)
        
        if c_mock1.button(t("simulate_panic")):
            import logging
            # We need to use the logger that writes to DB
            logger = logging.getLogger("aos.simulator")
            logger.error("Simulated PANIC attack!")
            logger.error("Another subsystem failure.")
            logger.error("Core meltdown imminent.")
            fetch_logs.clear()
            st.rerun()
            
        if c_mock2.button(t("simulate_bloat")):
            import logging
            logger = logging.getLogger("aos.simulator")
            logger.info("A" * 5000) # Inject huge log
            fetch_logs.clear()
            st.rerun()

elif page == "memory_vault":
    render_hero("🏛️", t("memory_vault"), t("memory_vault_subtitle"))
    
    # --- Top Control Bar ---
    with st.container(border=True):
        c1, c2 = st.columns([3, 1])
        query = c1.text_input(
            t("search"),
            label_visibility="collapsed",
            placeholder=t("search_wisdom_placeholder"),
        )
        if c2.button(t("refresh"), use_container_width=True):
            st.rerun()
    
    # Mock / Test: Manual Distillation
    with st.expander(f"🛠️ {t('manual_distillation')}"):
        target_trace = st.text_input(t("trace_id_to_distill"))
        view_col1, view_col2 = st.columns([1.2, 1])
        if view_col1.button(t("distill_trace"), use_container_width=True):
            if target_trace:
                with st.spinner(t("odysseus_analyzing")):
                    result = odysseus_service.distill_trace(target_trace)
                    if result:
                        st.success(f"{t('wisdom_extracted')}: {result.title}")
                    else:
                        st.error(t("trace_not_found"))
            else:
                st.warning(t("enter_trace_id"))

        if view_col2.button(t("open_trace_chain"), use_container_width=True):
            jump_to_trace_chain(target_trace.strip() if target_trace else None)

    st.divider()

    # --- Fetch & Display Wisdom ---
    if query:
        items = odysseus_service.search_wisdom(query)
    else:
        items = odysseus_service.get_all_wisdom()
        
    if not items:
        st.info(t("vault_empty"))
    
    for item in items:
        with st.container(border=True):
            col_a, col_b = st.columns([4, 1])
            col_a.subheader(f"📜 {item.title}")
            col_b.caption(item.created_at.strftime("%Y-%m-%d %H:%M"))
            
            st.markdown(item.content)
            
            # Tags
            tags = item.tags.split(",")
            st.markdown(" ".join([f"`#{t.strip()}`" for t in tags]))
            
            # Drill Down
            if st.button(f"🔍 {t('view_source_trace')}", key=f"btn_{item.id}"):
                jump_to_trace_chain(item.source_trace_id)
