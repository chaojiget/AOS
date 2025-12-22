"use client";

import * as React from "react";

export type Language = "zh" | "en";

const TRANSLATIONS: Record<Language, Record<string, string>> = {
  zh: {
    "app.title": "AOS 观测台",
    "app.subtitle": "神经流 + Trace Chain（默认中文，可切换英文）",
    "nav.neuralStream": "神经流",
    "nav.traceChain": "Trace Chain",
    "nav.memoryVault": "记忆库",
    "nav.agentChat": "Agent",
    "home.neuralStreamDesc": "实时查看最近日志，可一键跳转到对应 Trace Chain。",
    "home.traceChainDesc": "提供 Trace ID 列表与树状日志链（Span Tree）展开。",
    "home.memoryVaultDesc": "查看/检索逆熵记忆卡片（可手动蒸馏 Trace）。",
    "common.open": "打开",
    "common.refresh": "刷新",
    "common.loading": "加载中…",
    "common.empty": "暂无数据",
    "common.filters": "筛选",
    "common.level": "等级",
    "common.all": "全部",
    "common.limit": "数量",
    "common.search": "搜索…",
    "common.searchOptional": "搜索（可选）",
    "common.details": "展开详情",
    "common.close": "关闭",
    "common.openTraceChain": "打开 Trace Chain",
    "common.copyTraceId": "复制 Trace ID",
    "common.expandAll": "全部展开",
    "common.collapseAll": "全部收起",
    "common.prev": "上一个",
    "common.next": "下一个",
    "common.fit": "适配",
    "neuralStream.subtitle": "最近日志（来自 FastAPI / SQLite）。",
    "traceChain.subtitle": "Trace ID 列表 + Span Tree（点击即选，无需手输）。",
    "traceChain.traceList": "Trace 列表",
    "traceChain.filterPlaceholder": "过滤 trace id（可选）",
    "traceChain.selectedTrace": "当前 Trace",
    "traceChain.selectHint": "从左侧列表选择一个 Trace。",
    "traceChain.noLogs": "该 Trace 暂无日志。",
    "traceChain.treeTitle": "Span Tree",
    "traceChain.noSpans": "没有可构建的 Span（可能缺少 span_id / otel 元数据）。",
    "traceChain.orphanLogs": "未归属 Span 的日志",
    "traceChain.window": "时间段",
    "traceChain.window5m": "近 5 分钟",
    "traceChain.window30m": "近 30 分钟",
    "traceChain.window2h": "近 2 小时",
    "traceChain.window24h": "近 24 小时",
    "traceChain.earlier": "上一段",
    "traceChain.later": "下一段",
    "traceChain.latest": "最新",
    "traceChain.range": "范围",

    "deepTrace.title": "DeepTrace Observer",
    "deepTrace.searchPlaceholder": "搜索 Span 名称/ID（Ctrl+F）",
    "deepTrace.spans": "Spans",
    "deepTrace.logs": "日志",
    "deepTrace.errors": "错误",
    "deepTrace.duration": "耗时",
    "deepTrace.zoom": "缩放",
    "deepTrace.critical": "关键路径",
    "deepTrace.recentLogs": "最近日志",
    "deepTrace.attributes": "Attributes",

    "memory.subtitle": "逆熵记忆卡片（从 Trace 日志中蒸馏，可检索/召回）。",
    "memory.controls": "检索与蒸馏",
    "memory.searchPlaceholder": "按标题/内容/标签搜索",
    "memory.distill": "蒸馏 Trace",
    "memory.traceIdPlaceholder": "输入 trace_id…",
    "memory.distillBtn": "蒸馏",
    "memory.empty": "暂无记忆卡片",
    "memory.card": "记忆",
    "memory.openTrace": "打开 Trace",

    "agui.title": "AG-UI Chat",
    "agui.subtitle": "使用 AG-UI 协议与 Agent 流式交互（工具/状态/事件）。",
    "agui.placeholder": "输入你的指令…",
    "agui.send": "发送",
    "agui.stop": "停止",
    "agui.empty": "还没有对话，先发送一条消息。",
    "agui.hint": "提示：后端 AG-UI 端点是 /api/v1/ag-ui（SSE）。",
  },
  en: {
    "app.title": "AOS Observatory",
    "app.subtitle": "Neural Stream + Trace Chain (ZH default, EN toggle)",
    "nav.neuralStream": "Neural Stream",
    "nav.traceChain": "Trace Chain",
    "nav.memoryVault": "Memory Vault",
    "nav.agentChat": "Agent",
    "home.neuralStreamDesc": "Recent logs feed with one-click jump to Trace Chain.",
    "home.traceChainDesc": "Trace ID list + span tree view with expandable logs.",
    "home.memoryVaultDesc": "Search inverse-entropy memory cards (distill traces on demand).",
    "common.open": "Open",
    "common.refresh": "Refresh",
    "common.loading": "Loading…",
    "common.empty": "No data",
    "common.filters": "Filters",
    "common.level": "Level",
    "common.all": "All",
    "common.limit": "Limit",
    "common.search": "Search…",
    "common.searchOptional": "Search (optional)",
    "common.details": "Details",
    "common.close": "Close",
    "common.openTraceChain": "Open Trace Chain",
    "common.copyTraceId": "Copy Trace ID",
    "common.expandAll": "Expand all",
    "common.collapseAll": "Collapse all",
    "common.prev": "Prev",
    "common.next": "Next",
    "common.fit": "Fit",
    "neuralStream.subtitle": "Recent logs (FastAPI / SQLite).",
    "traceChain.subtitle": "Trace list + span tree (click to select, no manual input).",
    "traceChain.traceList": "Trace List",
    "traceChain.filterPlaceholder": "Filter trace id (optional)",
    "traceChain.selectedTrace": "Selected Trace",
    "traceChain.selectHint": "Select a trace from the list.",
    "traceChain.noLogs": "No logs for this trace.",
    "traceChain.treeTitle": "Span Tree",
    "traceChain.noSpans": "No spans to build (missing span_id / otel metadata).",
    "traceChain.orphanLogs": "Logs without a span",
    "traceChain.window": "Window",
    "traceChain.window5m": "Last 5m",
    "traceChain.window30m": "Last 30m",
    "traceChain.window2h": "Last 2h",
    "traceChain.window24h": "Last 24h",
    "traceChain.earlier": "Earlier",
    "traceChain.later": "Later",
    "traceChain.latest": "Latest",
    "traceChain.range": "Range",

    "deepTrace.title": "DeepTrace Observer",
    "deepTrace.searchPlaceholder": "Search span name/id (Ctrl+F)",
    "deepTrace.spans": "Spans",
    "deepTrace.logs": "Logs",
    "deepTrace.errors": "Errors",
    "deepTrace.duration": "Duration",
    "deepTrace.zoom": "Zoom",
    "deepTrace.critical": "Critical path",
    "deepTrace.recentLogs": "Recent logs",
    "deepTrace.attributes": "Attributes",

    "memory.subtitle": "Inverse-entropy memory cards distilled from traces.",
    "memory.controls": "Search & Distill",
    "memory.searchPlaceholder": "Search title/content/tags",
    "memory.distill": "Distill Trace",
    "memory.traceIdPlaceholder": "Enter trace_id…",
    "memory.distillBtn": "Distill",
    "memory.empty": "No memory cards yet",
    "memory.card": "Memory",
    "memory.openTrace": "Open Trace",

    "agui.title": "AG-UI Chat",
    "agui.subtitle": "Streamed agent interaction over AG-UI (tools/state/events).",
    "agui.placeholder": "Type an instruction…",
    "agui.send": "Send",
    "agui.stop": "Stop",
    "agui.empty": "No messages yet. Send one to start.",
    "agui.hint": "Backend AG-UI endpoint: /api/v1/ag-ui (SSE).",
  },
};

function translate(lang: Language, key: string): string {
  return TRANSLATIONS[lang][key] ?? TRANSLATIONS.zh[key] ?? key;
}

type I18nContextValue = {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string) => string;
};

const I18nContext = React.createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = React.useState<Language>("zh");

  React.useEffect(() => {
    const saved = window.localStorage.getItem("aos.lang");
    if (saved === "zh" || saved === "en") setLangState(saved);
  }, []);

  const setLang = React.useCallback((next: Language) => {
    setLangState(next);
    window.localStorage.setItem("aos.lang", next);
  }, []);

  const value = React.useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t: (key: string) => translate(lang, key),
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
