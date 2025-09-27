"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Settings, ShieldCheck, ServerCog, Signal } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Settings className="h-6 w-6" /> 系统设置
          </h1>
          <p className="text-sm text-muted-foreground">
            配置 LLM、可观测性、数据库与安全策略，所有变更将写入审计日志。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            导出配置
          </Button>
          <Button size="sm">保存全部</Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ServerCog className="h-5 w-5" /> LLM Provider
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">模型名称</label>
              <Input placeholder="如 gpt-4o-mini 或 glm-4-5-air" defaultValue="glm-4-5-air" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">API Key</label>
              <Input type="password" placeholder="•••••••" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Base URL</label>
              <Input placeholder="https://api.openai.com/v1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Signal className="h-5 w-5" /> OpenTelemetry
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Collector Endpoint</label>
              <Input placeholder="http://localhost:4318" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">采样率 (0-1)</label>
              <Input placeholder="1" defaultValue="1" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">指标导出说明</label>
              <Textarea rows={3} placeholder="可配置 Prometheus / ClickHouse 等" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5" /> 安全与权限
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">AOS_API_TOKENS</label>
            <Textarea
              rows={4}
              defaultValue='{"dev-admin-token":"owner","ops-view-token":"viewer"}'
              placeholder='{"token":"role"}'
            />
            <p className="text-xs text-muted-foreground">
              仅在后端 `.env` 中配置，页面展示用于说明角色分配策略。
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">IP 白名单</label>
            <Textarea rows={3} placeholder="10.0.0.0/24, 10.0.1.5" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">敏感项脱敏规则</label>
            <Textarea rows={3} placeholder="db.password -> ****" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">审计日志</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-48">
            <div className="space-y-2 text-xs text-muted-foreground">
              <div>2025-09-26 12:32 · owner · 更新 LLM 模型为 glm-4-5-air</div>
              <div>2025-09-26 11:10 · admin · 调整 OTel 采样率 0.2 → 1</div>
              <div>2025-09-25 22:03 · operator · 新增 IP 白名单 10.0.1.0/24</div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">配置说明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            所有保存操作将通过 `/config/system` 与 `/config/runtime` API 写入数据库，并记录到 `audit_logs`。
          </p>
          <p>
            敏感值仅在执行期解密，前端表单默认展示占位符，保存时会调用安全审计流程。
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">LLM</Badge>
            <Badge variant="outline">OTel</Badge>
            <Badge variant="outline">RBAC</Badge>
            <Badge variant="outline">审计</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
