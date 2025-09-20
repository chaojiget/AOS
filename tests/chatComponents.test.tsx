import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const vi = { fn: () => () => {} };

import ChatMain from "../components/chat/ChatMain";
import InsightsPanel from "../components/chat/InsightsPanel";
import Sidebar from "../components/chat/Sidebar";
import type { ChatHistoryMessage } from "../components/ChatMessageList";
import type { PlanTimelineEvent } from "../components/PlanTimeline";
import type { SkillEvent } from "../components/SkillPanel";
import { I18nProvider } from "../lib/i18n/index";

describe("Chat layout components", () => {
  it("renders sidebar information and draft snippet", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        heading="对话"
        traceNotice="当前会话 ID: trace-123"
        traceId="trace-123"
        episodesLabel="episodes"
        downloadLabel="下载"
        onSave={() => undefined}
        saveLabel="保存"
        disableSave={false}
        downloadHref="/api/episodes/trace-123"
        draftLabel="草稿"
        draftInput="用户草稿"
      />,
    );

    expect(html).toContain("episodes/trace-123.jsonl");
    expect(html).toContain("保存");
    expect(html).toContain("用户草稿");
  });

  it("renders chat main section with messages and final preview", () => {
    const messages: ChatHistoryMessage[] = [
      {
        id: "u1",
        role: "user",
        content: "你好",
        ts: new Date("2024-01-01T00:00:00Z").toISOString(),
        status: "done",
        msgId: "msg-u1",
      },
      {
        id: "a1",
        role: "assistant",
        content: "您好，有什么可以帮忙？",
        ts: new Date("2024-01-01T00:00:01Z").toISOString(),
        status: "done",
        msgId: "msg-a1",
      },
    ];

    const html = renderToStaticMarkup(
      <I18nProvider locale="zh-CN">
        <ChatMain
          panelTitle="对话"
          statusToneClass="bg-emerald-500/10"
          statusText="完成"
          traceId="trace-123"
          messages={messages}
          isRunning={false}
          finalPreview="执行完成"
          finalPreviewLabel="最终输出"
          inputLabel="指令"
          inputPlaceholder="请输入指令"
          inputValue="测试"
          onInputChange={() => undefined}
          onSubmit={vi.fn()}
          onRunShortcut={vi.fn()}
          submitLabel="运行"
          submitDisabled={false}
          helperText="闲置"
        />
      </I18nProvider>,
    );

    expect(html).toContain("trace-123");
    expect(html).toContain("最终输出");
    expect(html).toContain("执行完成");
    expect(html).toContain("运行");
  });

  it("renders insights panel sections", () => {
    const planEvents: PlanTimelineEvent[] = [
      {
        id: "plan-1",
        ts: new Date("2024-01-01T00:00:00Z").toISOString(),
        steps: [{ id: "s1", title: "准备", summary: "初始化" }],
      },
    ];
    const skillEvents: SkillEvent[] = [
      {
        id: "skill-1",
        type: "tool",
        ts: new Date("2024-01-01T00:00:05Z").toISOString(),
        name: "search",
        status: "succeeded",
        argsSummary: "查询数据",
      },
    ];

    const html = renderToStaticMarkup(
      <InsightsPanel
        guardianPanel={{
          heading: "Guardian",
          subtitle: "预算与告警",
          statusToneClass: "bg-sky-500/10",
          statusLabel: "正常",
          errorText: undefined,
          budget: {
            limitLabel: "额度",
            limitValue: "$10.00",
            usedLabel: "已用",
            usedValue: "$2.00",
            remainingLabel: "剩余",
            remainingValue: "$8.00",
            updatedAtText: "更新时间 2024/01/01",
          },
          alertsHeading: "告警",
          alertsCount: 1,
          alertsEmptyText: "暂无告警",
          alertsStreamErrorText: undefined,
          alertsReplayLabel: "回放",
          alertsApproveLabel: "通过",
          alertsRejectLabel: "拒绝",
          alertsSubmittedLabel: "已提交",
          alerts: [
            {
              id: "alert-1",
              message: "请确认预算",
              severityLabel: "warning",
              severityToneClass: "bg-amber-500/10",
              statusLabel: "open",
              statusToneClass: "bg-sky-500/10",
              timestamp: "2024-01-01",
              replayHref: "https://example.com",
              showApproval: true,
              isPending: false,
              onApprove: vi.fn(),
              onReject: vi.fn(),
              submittedText: undefined,
              errorText: undefined,
            },
          ],
        }}
        runStats={{
          title: "运行指标",
          statusToneClass: "bg-emerald-500/10",
          statusText: "完成",
          items: [
            { label: "Trace", value: "trace-123" },
            { label: "Latency", value: "1200 ms" },
          ],
          errorMessage: undefined,
          noticeText: "流式传输",
        }}
        rawResponse={{
          title: "最新响应",
          isOpen: false,
          onToggle: vi.fn(),
          collapseLabel: "收起",
          expandLabel: "展开",
          content: "{}",
          summary: "暂无响应",
        }}
        planTimeline={{
          events: planEvents,
          filter: "",
          collapsed: false,
          onFilterChange: vi.fn(),
          onToggleCollapse: vi.fn(),
          labels: {
            heading: "计划",
            filterPlaceholder: "筛选",
            collapse: "收起",
            expand: "展开",
            empty: "暂无计划",
            updatedAt: (value: string) => value,
            revision: () => "rev",
            reason: () => "原因",
            stepCount: () => "1",
          },
        }}
        skillPanel={{
          events: skillEvents,
          filter: "",
          collapsed: false,
          onFilterChange: vi.fn(),
          onToggleCollapse: vi.fn(),
          labels: {
            heading: "技能",
            filterPlaceholder: "搜索技能",
            collapse: "收起",
            expand: "展开",
            empty: "暂无技能",
            status: {
              started: "开始",
              succeeded: "成功",
              failed: "失败",
            },
            metricLabels: {
              latency: "延迟",
              cost: "成本",
              tokens: "Token",
            },
            metrics: {
              cost: () => "--",
              latency: () => "--",
              tokens: () => "--",
            },
            noteLabel: () => "备注",
          },
        }}
      />,
    );

    expect(html).toContain("Guardian");
    expect(html).toContain("告警");
    expect(html).toContain("运行指标");
    expect(html).toContain("最新响应");
    expect(html).toContain("计划");
    expect(html).toContain("技能");
  });
});
