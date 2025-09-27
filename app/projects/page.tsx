"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ListChecks, PlayCircle, RefreshCcw, RotateCcw } from "lucide-react";

const mockTasks = [
  {
    id: "RUN-1024",
    title: "视频审核 SOP",
    status: "进行中",
    owner: "ops",
    updatedAt: "5 分钟前",
  },
  {
    id: "RUN-1023",
    title: "数据集清洗",
    status: "排队",
    owner: "ops",
    updatedAt: "10 分钟前",
  },
  {
    id: "RUN-1022",
    title: "新功能冒烟测试",
    status: "已完成",
    owner: "qa",
    updatedAt: "25 分钟前",
  },
];

const mockBlueprints = [
  {
    id: "SOP-14",
    name: "AOS 发布流程",
    version: "v3.2",
    updatedAt: "昨天 23:10",
    status: "启用",
  },
  {
    id: "SOP-11",
    name: "异常恢复模板",
    version: "v1.4",
    updatedAt: "两天前",
    status: "草稿",
  },
];

export default function ProjectsPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ListChecks className="h-6 w-6" /> 项目管理
          </h1>
          <p className="text-sm text-muted-foreground">
            统一查看任务执行、SOP 蓝图与回放记录，支撑 Chat Hub 的价值事件流。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <RotateCcw className="mr-2 h-4 w-4" /> 重跑最近任务
          </Button>
          <Button size="sm">
            <PlayCircle className="mr-2 h-4 w-4" /> 新建任务
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">进行中任务</CardTitle>
            <p className="text-sm text-muted-foreground">
              按状态分组展示最新执行记录，可跳转至回放详情。
            </p>
          </div>
          <Button variant="secondary" size="sm">
            <RefreshCcw className="mr-2 h-4 w-4" /> 刷新
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {mockTasks.map((task) => (
            <div
              key={task.id}
              className="flex flex-col rounded-lg border p-3 transition-colors hover:bg-muted/60 md:flex-row md:items-center md:justify-between"
            >
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
                  <span>{task.title}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  负责人 {task.owner} · 更新于 {task.updatedAt}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 md:mt-0">
                <Badge variant={
                  task.status === "已完成"
                    ? "secondary"
                    : task.status === "进行中"
                    ? "default"
                    : "outline"
                }>
                  {task.status}
                </Badge>
                <Button size="sm" variant="outline">
                  查看事件
                </Button>
                <Button size="sm" variant="ghost">
                  打开回放
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">SOP 蓝图版本</CardTitle>
          <p className="text-sm text-muted-foreground">
            版本化管理每个项目的 SOP，支持可视编辑与一键发布。
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {mockBlueprints.map((bp) => (
            <div key={bp.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">{bp.name}</div>
                <Badge variant={bp.status === "启用" ? "default" : "outline"}>
                  {bp.status}
                </Badge>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                版本 {bp.version} · 更新于 {bp.updatedAt}
              </div>
              <Separator className="my-3" />
              <div className="flex gap-2 text-xs">
                <Button size="sm" variant="outline">
                  查看 JSON
                </Button>
                <Button size="sm" variant="ghost">
                  发布模板
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">回放 / Replay</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          回放与重跑视图正在规划中，将串联 `task.receipt`、Trace 以及产物下载，并支持审批策略与差异对比。
        </CardContent>
      </Card>
    </div>
  );
}
