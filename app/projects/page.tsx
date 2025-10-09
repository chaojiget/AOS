"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ListChecks, PlayCircle, RefreshCcw, RotateCcw, Timer, Workflow } from "lucide-react";
import {
  getProjectsEndpoint,
} from "@/lib/apiConfig";
import { getStoredApiToken, onApiTokenChange } from "@/lib/authToken";

interface RunTimelineEntry {
  id: string;
  label: string;
  status: "pending" | "completed" | "error" | "running";
  description?: string;
  occurredAt?: string;
}

interface RunArtifact {
  id: string;
  name: string;
  type: "log" | "file" | "dataset" | "report";
  size: number;
  downloadUrl?: string;
}

interface ProjectRunRecord {
  id: string;
  projectId: string;
  title: string;
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  owner: string;
  triggeredBy: string;
  startedAt: string;
  finishedAt?: string;
  traceId: string;
  summary: string;
  approvalRequired: boolean;
  timeline: RunTimelineEntry[];
  artifacts: RunArtifact[];
  metadata?: Record<string, unknown>;
}

interface SopBlueprintVersion {
  id: string;
  name: string;
  version: string;
  status: "active" | "draft" | "archived";
  updatedAt: string;
  description?: string;
  editor?: string;
}

interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
  owner: string;
  tags: string[];
  latestRun?: ProjectRunRecord;
  activeRuns: ProjectRunRecord[];
  queuedRuns: ProjectRunRecord[];
  completedRuns: ProjectRunRecord[];
  sopVersions: SopBlueprintVersion[];
}

const statusBadgeVariant = (status: ProjectRunRecord["status"]) => {
  switch (status) {
    case "running":
      return "default" as const;
    case "queued":
      return "outline" as const;
    case "success":
      return "secondary" as const;
    case "failed":
    case "cancelled":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
};

const statusLabel = (status: ProjectRunRecord["status"]) => {
  switch (status) {
    case "running":
      return "执行中";
    case "queued":
      return "排队";
    case "success":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "--";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatTime = (iso: string | undefined) => {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
};

const formatDuration = (run: ProjectRunRecord) => {
  const start = new Date(run.startedAt).getTime();
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return "--";
  const diff = Math.max(end - start, 0);
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    return `${hours} 小时 ${restMinutes} 分`;
  }
  if (minutes > 0) {
    return `${minutes} 分 ${seconds} 秒`;
  }
  return `${seconds} 秒`;
};

const renderTimelineStatus = (status: RunTimelineEntry["status"]) => {
  switch (status) {
    case "completed":
      return "已完成";
    case "running":
      return "进行中";
    case "pending":
      return "待执行";
    case "error":
      return "异常";
    default:
      return status;
  }
};

export default function ProjectsPage() {
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<ProjectRunRecord | null>(null);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const stored = getStoredApiToken();
    setApiToken(stored ?? null);
    const unsubscribe = onApiTokenChange((token) => {
      setApiToken(token ?? null);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (apiToken) {
      fetchProjects();
    } else {
      setProjects([]);
      setSelectedProjectId(null);
    }
  }, [apiToken, fetchProjects]);

  useEffect(() => {
    const runId = searchParams.get("run");
    if (runId && projects.length && !selectedRun) {
      const project = projects.find((proj) =>
        [proj.latestRun, ...proj.activeRuns, ...proj.queuedRuns, ...proj.completedRuns].some(
          (run) => run?.id === runId,
        ),
      );
      if (project) {
        openRunDetail(project.id, runId);
      }
    }
  }, [projects, searchParams, selectedRun, openRunDetail]);

  const selectedProject = useMemo(() => {
    if (!selectedProjectId) {
      return projects[0];
    }
    return projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  }, [projects, selectedProjectId]);

  const authorizedHeaders = useMemo(() => {
    if (!apiToken) return undefined;
    return {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    } as Record<string, string>;
  }, [apiToken]);

  const fetchProjects = useCallback(async () => {
    if (!apiToken) {
      setError("请先配置 API Token");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(getProjectsEndpoint(""), {
        method: "GET",
        headers: authorizedHeaders,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `加载失败 (${response.status})`);
      }
      const data = (await response.json()) as { projects: ProjectSummary[] };
      setProjects(data.projects ?? []);
      if (data.projects?.length && !selectedProjectId) {
        setSelectedProjectId(data.projects[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [apiToken, authorizedHeaders, selectedProjectId]);

  const fetchRun = useCallback(async (projectId: string, runId: string) => {
    if (!apiToken) return null;
    try {
      const response = await fetch(getProjectsEndpoint(`/${projectId}/runs/${runId}`), {
        method: "GET",
        headers: authorizedHeaders,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "加载运行详情失败");
      }
      const data = (await response.json()) as { run: ProjectRunRecord };
      return data.run;
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载运行详情失败");
      return null;
    }
  }, [apiToken, authorizedHeaders]);

  const openRunDetail = useCallback(
    async (projectId: string, runId: string) => {
      const run = await fetchRun(projectId, runId);
      if (!run) return;
      setSelectedProjectId(projectId);
      setSelectedRun(run);
      setRunModalOpen(true);
      const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
      params.set("run", runId);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [fetchRun, pathname, router],
  );

  const closeRunDetail = useCallback(() => {
    setRunModalOpen(false);
    setSelectedRun(null);
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    params.delete("run");
    router.replace(params.size ? `${pathname}?${params.toString()}` : pathname);
  }, [pathname, router]);

  const triggerRun = useCallback(async (projectId: string, sourceRunId?: string) => {
    if (!apiToken) {
      setError("请先配置 API Token");
      return;
    }
    try {
      const response = await fetch(getProjectsEndpoint(`/${projectId}/runs`), {
        method: "POST",
        headers: authorizedHeaders,
        body: JSON.stringify({ sourceRunId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "触发运行失败");
      }
      const data = (await response.json()) as { run: ProjectRunRecord };
      await fetchProjects();
      await openRunDetail(projectId, data.run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "触发运行失败");
    }
  }, [apiToken, authorizedHeaders, fetchProjects, openRunDetail]);

  const visibleRuns = useMemo(() => {
    if (!selectedProject) return { current: [], completed: [] as ProjectRunRecord[] };
    const current = [...selectedProject.activeRuns, ...selectedProject.queuedRuns];
    const completed = selectedProject.completedRuns;
    return { current, completed };
  }, [selectedProject]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ListChecks className="h-6 w-6" /> 项目管理
          </h1>
          <p className="text-sm text-muted-foreground">
            打通任务执行、SOP 蓝图与 Chat Hub 价值事件，支持 Trace / 回放联动。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchProjects()} disabled={loading}>
            <RefreshCcw className="mr-2 h-4 w-4" /> 刷新
          </Button>
          {selectedProject && (
            <Button size="sm" onClick={() => triggerRun(selectedProject.id)} disabled={loading}>
              <PlayCircle className="mr-2 h-4 w-4" /> 新建任务
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-base">项目列表</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {projects.length === 0 && (
              <div className="text-sm text-muted-foreground">
                {apiToken ? "暂无项目数据" : "请在设置中配置 API Token"}
              </div>
            )}
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => setSelectedProjectId(project.id)}
                className={`w-full rounded-md border p-3 text-left text-sm transition-colors hover:bg-muted/70 ${
                  (selectedProject?.id ?? selectedProjectId) === project.id
                    ? "border-primary bg-primary/5"
                    : "border-transparent"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{project.name}</span>
                  <Badge variant="secondary">{project.tags[0] ?? "--"}</Badge>
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {project.description || "未填写描述"}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        {selectedProject && (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-lg">当前运行</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    查看排队与执行中的任务，可一键跳转回放。
                  </p>
                </div>
                <div className="flex gap-2">
                  {visibleRuns.current.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => triggerRun(selectedProject.id, visibleRuns.current[0].id)}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" /> 重跑当前
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {visibleRuns.current.length === 0 && (
                  <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    当前没有排队或执行中的任务。
                  </div>
                )}
                {visibleRuns.current.map((run) => (
                  <div
                    key={run.id}
                    className="flex flex-col gap-2 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="font-mono text-xs text-muted-foreground">{run.id}</span>
                        <span>{run.title}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        发起人 {run.triggeredBy} · 开始于 {formatTime(run.startedAt)}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center">
                      <Badge variant={statusBadgeVariant(run.status)}>{statusLabel(run.status)}</Badge>
                      <Button size="sm" variant="outline" onClick={() => openRunDetail(run.projectId, run.id)}>
                        查看详情
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => triggerRun(run.projectId, run.id)}>
                        重跑
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">近期完成</CardTitle>
                <p className="text-sm text-muted-foreground">按完成时间倒序展示最近记录。</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {visibleRuns.completed.length === 0 && (
                  <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    暂无完成记录。
                  </div>
                )}
                {visibleRuns.completed.map((run) => (
                  <div
                    key={run.id}
                    className="flex flex-col gap-2 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="font-mono text-xs text-muted-foreground">{run.id}</span>
                        <span>{run.title}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        用时 {formatDuration(run)} · 完成于 {formatTime(run.finishedAt)}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center">
                      <Badge variant={statusBadgeVariant(run.status)}>{statusLabel(run.status)}</Badge>
                      <Button size="sm" variant="outline" onClick={() => openRunDetail(run.projectId, run.id)}>
                        查看详情
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => triggerRun(run.projectId, run.id)}>
                        重跑
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
                  管理项目 SOP 模板，支持审计编辑历史与一键发布。
                </p>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {selectedProject.sopVersions.map((bp) => (
                  <div key={bp.id} className="rounded-lg border p-4">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{bp.name}</div>
                      <Badge variant={bp.status === "active" ? "default" : "outline"}>
                        {bp.status === "active" ? "启用" : bp.status === "draft" ? "草稿" : "归档"}
                      </Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      版本 {bp.version} · 更新于 {formatTime(bp.updatedAt)} · 编辑 {bp.editor ?? "--"}
                    </div>
                    {bp.description && (
                      <p className="mt-2 text-xs text-muted-foreground">{bp.description}</p>
                    )}
                    <Separator className="my-3" />
                    <div className="flex gap-2 text-xs">
                      <Button size="sm" variant="outline">
                        <Workflow className="mr-2 h-4 w-4" /> 查看 JSON
                      </Button>
                      <Button size="sm" variant="ghost">
                        <Timer className="mr-2 h-4 w-4" /> 发布模板
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <Dialog open={runModalOpen} onOpenChange={(open) => (open ? setRunModalOpen(true) : closeRunDetail())}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>运行详情</DialogTitle>
          </DialogHeader>
          {selectedRun ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{selectedRun.title}</span>
                  <Badge variant={statusBadgeVariant(selectedRun.status)}>{statusLabel(selectedRun.status)}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  Run ID: {selectedRun.id} · Trace {selectedRun.traceId}
                </div>
                <div className="text-xs text-muted-foreground">
                  发起人 {selectedRun.triggeredBy} · 开始 {formatTime(selectedRun.startedAt)}
                </div>
                <div className="text-xs text-muted-foreground">
                  用时 {formatDuration(selectedRun)}
                </div>
              </div>

              <div className="rounded-lg border p-4 text-sm">
                <div className="font-medium">执行摘要</div>
                <p className="mt-2 text-muted-foreground">{selectedRun.summary}</p>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium">执行时间线</div>
                <ScrollArea className="max-h-64 rounded-lg border p-3 text-sm">
                  <div className="space-y-3">
                    {selectedRun.timeline.map((step) => (
                      <div key={step.id} className="rounded-md border p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{step.label}</span>
                          <Badge variant="outline">{renderTimelineStatus(step.status)}</Badge>
                        </div>
                        {step.description && (
                          <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
                        )}
                        {step.occurredAt && (
                          <p className="mt-1 text-xs text-muted-foreground">时间 {formatTime(step.occurredAt)}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium">产物</div>
                {selectedRun.artifacts.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                    暂无产物记录。
                  </div>
                ) : (
                  <div className="space-y-2 text-xs">
                    {selectedRun.artifacts.map((artifact) => (
                      <div
                        key={artifact.id}
                        className="flex flex-col gap-1 rounded-md border p-3 md:flex-row md:items-center md:justify-between"
                      >
                        <div>
                          <div className="font-medium">{artifact.name}</div>
                          <div className="text-muted-foreground">
                            类型 {artifact.type} · 大小 {formatBytes(artifact.size)}
                          </div>
                        </div>
                        <Button size="sm" variant="outline" disabled={!artifact.downloadUrl}>
                          下载
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => triggerRun(selectedRun.projectId, selectedRun.id)}>
                  <RotateCcw className="mr-2 h-4 w-4" /> 重跑
                </Button>
                <Button onClick={() => closeRunDetail()}>关闭</Button>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-sm text-muted-foreground">正在加载运行详情...</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
