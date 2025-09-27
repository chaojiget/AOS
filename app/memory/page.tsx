"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookOpen, Filter, Upload } from "lucide-react";

const mockProfiles = [
  {
    id: "user-001",
    name: "张伟",
    tags: ["安全偏好", "审批必选"],
    summary: "倾向于保守策略，敏感操作需要双人确认",
  },
  {
    id: "user-002",
    name: "李丽",
    tags: ["成本敏感"],
    summary: "优先使用经济模型，关注执行耗时",
  },
];

const mockVariables = [
  {
    key: "DB_PASSWORD",
    scope: "project:aos",
    usage: "数据库连接",
  },
  {
    key: "SLACK_WEBHOOK",
    scope: "project:aos",
    usage: "告警推送",
  },
];

export default function MemoryPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <BookOpen className="h-6 w-6" /> 记忆管理
          </h1>
          <p className="text-sm text-muted-foreground">
            管理用户画像、项目变量与运行记忆，支持筛选、屏蔽与审计。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Filter className="mr-2 h-4 w-4" /> 筛选
          </Button>
          <Button size="sm">
            <Upload className="mr-2 h-4 w-4" /> 导入记忆
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">用户画像</CardTitle>
            <p className="text-sm text-muted-foreground">
              基于交互日志生成，可手动编辑与屏蔽敏感偏好。
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {mockProfiles.map((profile) => (
              <div key={profile.id} className="rounded-lg border p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span>{profile.name}</span>
                  <Badge variant="secondary">{profile.id}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {profile.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">{profile.summary}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">变量库</CardTitle>
            <p className="text-sm text-muted-foreground">
              运行时环境变量仅执行期可见，支持继承与审计。
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {mockVariables.map((item) => (
              <div key={item.key} className="rounded-lg border p-3">
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>{item.key}</span>
                  <Badge variant="secondary">{item.scope}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">用途：{item.usage}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">记忆编辑器</CardTitle>
          <p className="text-sm text-muted-foreground">
            支持增删改查、差异比对与审计回溯。
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">记忆名称</label>
            <Input placeholder="例如：项目偏好 / 运行策略" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">作用域</label>
            <Input placeholder="project:aos 或 task:xxx" />
          </div>
          <div className="md:col-span-2 space-y-2">
            <label className="text-sm font-medium">内容</label>
            <Textarea rows={6} placeholder="支持 Markdown，保存后将写入审计表" />
          </div>
          <div className="flex gap-2">
            <Button size="sm">保存</Button>
            <Button size="sm" variant="outline">
              预览差异
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">审计记录</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-48">
            <div className="space-y-2 text-xs text-muted-foreground">
              <div>2025-09-26 12:30 · admin · 更新变量 SLACK_WEBHOOK</div>
              <div>2025-09-26 11:58 · operator · 屏蔽用户画像 张伟</div>
              <div>2025-09-25 20:12 · owner · 导入项目 AOS 偏好记忆</div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
