# AOS Dashboard

Streamlit-based dashboard for observing the AOS agent system.

## usage

```bash
uv run streamlit run apps/aos_dashboard/app.py
```

## UI theme

- Streamlit theme: `.streamlit/config.toml`
- Glassmorphism styles: `apps/aos_dashboard/app.py` (`apply_glassmorphism_theme()`)

## i18n

- Languages: Chinese (default) + English
- Switch in the sidebar: `语言 / Language`
- Translations live in `apps/aos_dashboard/app.py` (`TRANSLATIONS`, `t()`)

## trace chain

- Open from **Neural Stream** → select a row → `打开日志链 / Open Trace Chain`
- Open from **Memory Vault** → `查看来源 Trace / View Source Trace`
- Or use the **Trace Chain** module and pick a Trace from the **Trace List** (no typing needed)
- View modes: `树 / Tree` (span tree) or `列表 / Flat` (time-ordered)
- Optional: paste a Trace ID in `手动 Trace ID / Manual Trace ID`.

## neural stream

- View modes: `展开 / Expandable` (click to open each log) or `表格 / Table` (select row to see details).

If you enable the OpenCode plugin (`.opencode/plugin/aos_connector.js`) and run the backend, OpenCode events will show up in the **Neural Stream**.
