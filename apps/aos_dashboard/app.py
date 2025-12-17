from __future__ import annotations

import json
from typing import Any

import pandas as pd
import streamlit as st
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
with st.sidebar:
    with st.container(border=True):
        st.markdown("### AOS v0.2")
        st.caption("The Sisyphus Protocol")

    page = st.radio("Module", ["Neural Stream", "Entropy Monitor", "Memory Vault"])

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
                "Attributes": r.attributes
            }
            for r in results
        ]
        return pd.DataFrame(data)

# --- Neural Stream Page ---
if page == "Neural Stream":
    st.markdown(
        """
        <div class="aos-hero">
          <div class="aos-hero-icon">🧠</div>
          <div>
            <div class="aos-hero-title">Neural Stream</div>
            <div class="aos-hero-subtitle">Real-time logs with quick filters and drill-down details.</div>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    
    with st.container(border=True):
        filter_col1, filter_col2, filter_col3 = st.columns([3, 1.2, 1])
        search_term = filter_col1.text_input(
            "Search",
            placeholder="Message text or Trace ID…",
            label_visibility="collapsed",
        )
        level_filter = filter_col2.multiselect(
            "Level",
            options=["INFO", "WARNING", "ERROR"],
            default=["INFO", "WARNING", "ERROR"],
        )

        if filter_col3.button("Refresh", use_container_width=True):
            fetch_logs.clear()

    df = fetch_logs()
    
    if df.empty:
        st.info("No logs found in the memory stream.")
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
        
        col1.metric("Recent Entries", total_logs)
        col2.metric("Errors (Last 100)", error_count, delta_color="inverse")
        col3.metric("Active Traces", active_traces)

        st.divider()

        df_view = pd.DataFrame(
            {
                "Time": df["Time"].apply(lambda dt: dt.strftime("%H:%M:%S")),
                "Level": df["Level"],
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
                "Time": st.column_config.TextColumn(width="small"),
                "Level": st.column_config.TextColumn(width="small"),
                "Logger": st.column_config.TextColumn(width="medium"),
                "Message": st.column_config.TextColumn(width="large"),
                "Trace ID": st.column_config.TextColumn(width="medium"),
            },
        )

        selected_row = None
        if hasattr(event, "selection") and event.selection.rows:
            selected_row = df.iloc[event.selection.rows[0]].to_dict()

        if selected_row:
            with st.container(border=True):
                st.subheader("Log Details")
                meta1, meta2, meta3, meta4 = st.columns([1.1, 1, 1.4, 2])
                meta1.caption(f"Time: `{selected_row['Time']}`")
                meta2.caption(f"Level: `{selected_row['Level']}`")
                meta3.caption(f"Trace ID: `{selected_row['Trace ID']}`")
                meta4.caption(f"Logger: `{selected_row['Logger']}`")

                st.code(selected_row["Message"], language="text")
                if selected_row.get("Attributes"):
                    st.caption("Attributes / Traceback")
                    try:
                        st.json(json.loads(selected_row["Attributes"]))
                    except json.JSONDecodeError:
                        st.text(selected_row["Attributes"])

# --- Placeholders ---
elif page == "Entropy Monitor":
    st.markdown(
        """
        <div class="aos-hero">
          <div class="aos-hero-icon">📉</div>
          <div>
            <div class="aos-hero-title">Entropy Monitor</div>
            <div class="aos-hero-subtitle">Context pressure and system anxiety signals.</div>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    
    st.markdown("### The State of Sisyphus")
    
    # Refresh logic similar to logs
    if st.button("Refresh Physics"):
        fetch_logs.clear()
        
    df = fetch_logs()
    
    if df.empty:
        st.warning("No data to analyze.")
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
        c1.metric("Token Entropy", f"{current_tokens} / {max_tokens}", f"{current_tokens/max_tokens:.1%}")
        c2.metric("Anxiety Level", f"{anxiety_score:.2f}", delta_color="inverse")
        
        status_color = "green"
        status_text = "HEALTHY"
        if should_reset:
            status_color = "red"
            status_text = "CRITICAL (RESET IMMINENT)"
        elif anxiety_score > 0.5:
            status_color = "orange"
            status_text = "ANXIOUS"
            
        c3.markdown(f"**Status**: :{status_color}[{status_text}]")
        
        # Visual Bars
        st.caption("Context Pressure (Entropy)")
        st.progress(min(current_tokens / max_tokens, 1.0))
        
        st.caption("Anxiety (Error Rate)")
        st.progress(anxiety_score)
        
        # Mock Tools
        st.divider()
        st.subheader("🧪 Laboratory")
        c_mock1, c_mock2 = st.columns(2)
        
        if c_mock1.button("Simulate Panic (Inject Errors)"):
            import logging
            from aos_telemetry.config import setup_telemetry
            # We need to use the logger that writes to DB
            logger = logging.getLogger("aos.simulator")
            logger.error("Simulated PANIC attack!")
            logger.error("Another subsystem failure.")
            logger.error("Core meltdown imminent.")
            fetch_logs.clear()
            st.rerun()
            
        if c_mock2.button("Simulate Context Bloat"):
            import logging
            logger = logging.getLogger("aos.simulator")
            logger.info("A" * 5000) # Inject huge log
            fetch_logs.clear()
            st.rerun()

elif page == "Memory Vault":
    st.markdown(
        """
        <div class="aos-hero">
          <div class="aos-hero-icon">🏛️</div>
          <div>
            <div class="aos-hero-title">Memory Vault</div>
            <div class="aos-hero-subtitle">Long-term wisdom distilled from past lives (Trace Sessions).</div>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    
    # --- Top Control Bar ---
    with st.container(border=True):
        c1, c2 = st.columns([3, 1])
        query = c1.text_input("Search Wisdom (Keywords or Tags)", label_visibility="collapsed", placeholder="Keywords or #tags…")
        if c2.button("Refresh", use_container_width=True):
            st.rerun()
    
    # Mock / Test: Manual Distillation
    with st.expander("🛠️ Manual Distillation (Test)"):
        target_trace = st.text_input("Trace ID to Distill")
        if st.button("Distill Trace"):
            if target_trace:
                with st.spinner("Odysseus is analyzing..."):
                    result = odysseus_service.distill_trace(target_trace)
                    if result:
                        st.success(f"Wisdom Extracted: {result.title}")
                    else:
                        st.error("Trace not found or empty.")
            else:
                st.warning("Please enter a Trace ID.")

    st.divider()

    # --- Fetch & Display Wisdom ---
    if query:
        items = odysseus_service.search_wisdom(query)
    else:
        items = odysseus_service.get_all_wisdom()
        
    if not items:
        st.info("The Vault is empty. Sisyphus hasn't learned anything yet... or hasn't died enough.")
    
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
            if st.button("🔍 View Source Trace", key=f"btn_{item.id}"):
                # We can't jump tabs easily in Streamlit, but we can show logs right here
                st.markdown("#### Source Log Chain")
                
                # Fetch Logs for this trace
                # (Reusing fetch_logs logic but filtering manually for now or ad-hoc query)
                with Session(engine) as session:
                    logs = session.exec(select(LogEntry).where(LogEntry.trace_id == item.source_trace_id).order_by(LogEntry.timestamp)).all()
                    
                if logs:
                    for log in logs:
                        icon = "🔴" if log.level == "ERROR" else "🔵"
                        st.markdown(f"{icon} `{log.timestamp.strftime('%H:%M:%S')}`: {log.message}")
                else:
                    st.warning("Source logs have been purged (Inverse Entropy in action).")
