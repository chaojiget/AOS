"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getMcpEndpoint } from "@/lib/apiConfig";
import { getStoredApiToken, setStoredApiToken } from "@/lib/authToken";
import { Cpu, Play, RefreshCw } from "lucide-react";

interface SandboxScript {
  id: string;
  name: string;
  entryFile: string;
  description?: string;
  scheduleMs?: number | null;
  env?: Record<string, string>;
}

interface SandboxRunRow {
  runId: string;
  scriptId: string;
  status: "success" | "error";
  output: string;
  error?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  trigger: "manual" | "schedule";
  actor?: string;
}

type ScriptFormState = {
  mode: "create" | "edit";
  id?: string;
  name: string;
  entryFile: string;
  description: string;
  scheduleMs: number | null;
  envJson: string;
};

const createDefaultScriptForm = (): ScriptFormState => ({
  mode: "create",
  name: "",
  entryFile: "",
  description: "",
  scheduleMs: null,
  envJson: "{}",
});

const safeJsonParse = (value: string) => {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      Object.entries(parsed).forEach(([key, val]) => {
        if (typeof val !== "string") {
          throw new Error(`环境变量 ${key} 必须是字符串`);
        }
      });
      return parsed as Record<string, string>;
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "JSON 解析失败");
  }
  return {};
};

const formatDuration = (ms: number) => {
  if (!ms || Number.isNaN(ms)) return "-";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
};

export default function AgentsPage() {
  const [apiToken, setApiToken] = useState("");
  const [scripts, setScripts] = useState<SandboxScript[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [runs, setRuns] = useState<SandboxRunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ScriptFormState>(createDefaultScriptForm);
  const [isFormVisible, setFormVisible] = useState(false);
  const [runLoading, setRunLoading] = useState(false);

  useEffect(() => {
    const stored = getStoredApiToken();
    if (stored) {
      setApiToken(stored);
    }
  }, []);

  useEffect(() => {
    if (apiToken) {
      loadScripts();
    }
  }, [apiToken]);

  useEffect(() => {
    if (apiToken && selectedScriptId) {
      loadRuns(selectedScriptId);
    }
  }, [apiToken, selectedScriptId]);

  const authorizedHeaders = useMemo(() => {
    if (!apiToken) return undefined;
    return {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    } as Record<string, string>;
  }, [apiToken]);

  const loadScripts = async () => {
    if (!apiToken) {
      setError("请先配置 API Token");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(getMcpEndpoint("/sandbox/scripts"), {
        headers: authorizedHeaders,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `加载失败 (${response.status})`);
      }
      const data = (await response.json()) as { scripts: SandboxScript[] };
      setScripts(data.scripts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const loadRuns = async (scriptId: string) => {
    try {
      const response = await fetch(
        getMcpEndpoint(`/sandbox/scripts/${encodeURIComponent(scriptId)}/runs?limit=10`),
        { headers: authorizedHeaders }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "读取运行记录失败");
      }
      const data = (await response.json()) as { runs: SandboxRunRow[] };
      setRuns(data.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取运行记录失败");
    }
  };

  const openCreateForm = () => {
    setForm(createDefaultScriptForm());
    setFormVisible(true);
  };

  const openEditForm = (script: SandboxScript) => {
    setForm({
      mode: "edit",
      id: script.id,
      name: script.name,
      entryFile: script.entryFile,
      description: script.description ?? "",
      scheduleMs: script.scheduleMs ?? null,
      envJson: JSON.stringify(script.env ?? {}, null, 2),
    });
    setFormVisible(true);
  };

  const handleFormChange = (partial: Partial<ScriptFormState>) => {
    setForm((prev) => ({ ...prev, ...partial }));
  };

  const submitScriptForm = async () => {
    if (!apiToken) {
      setError("请先配置 API Token");
      return;
    }
    if (!form.name.trim() || !form.entryFile.trim()) {
      setError("名称与入口文件为必填项");
      return;
    }

    let env: Record<string, string> | undefined;
    if (form.envJson.trim()) {
      env = safeJsonParse(form.envJson.trim());
    }

    const payload = {
      name: form.name.trim(),
      entryFile: form.entryFile.trim(),
      description: form.description.trim() || undefined,
      scheduleMs: form.scheduleMs ?? null,
      env,
    };

    const endpoint =
      form.mode === "create"
        ? getMcpEndpoint("/sandbox/scripts")
        : getMcpEndpoint(`/sandbox/scripts/${encodeURIComponent(form.id!)}`);
    const method = form.mode === "create" ? "POST" : "PATCH";

    try {
      const response = await fetch(endpoint, {
        method,
        headers: authorizedHeaders,
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "保存脚本失败");
      }
      setFormVisible(false);
      await loadScripts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  };

  const deleteScript = async (scriptId: string) => {
    if (!apiToken) return;
    if (!window.confirm("确定删除该脚本？")) return;
    try {
      const response = await fetch(getMcpEndpoint(`/sandbox/scripts/${encodeURIComponent(scriptId)}`), {
        method: "DELETE",
        headers: authorizedHeaders,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "删除失败");
      }
      if (selectedScriptId === scriptId) {
        setSelectedScriptId(null);
        setRuns([]);
      }
      await loadScripts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  };

  const triggerRun = async (scriptId: string) => {
    if (!apiToken) return;
    setRunLoading(true);
    try {
      const response = await fetch(getMcpEndpoint(`/sandbox/scripts/${encodeURIComponent(scriptId)}/run`), {
        method: "POST",
        headers: authorizedHeaders,
        body: JSON.stringify({ trigger: "manual" }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "执行失败");
      }
      await loadRuns(scriptId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "执行失败");
    } finally {
      setRunLoading(false);
    }
  };

  const saveTokenLocally = () => {
    setStoredApiToken(apiToken);
  };

  const selectedScript = scripts.find((item) => item.id === selectedScriptId) ?? null;

  return (
    <div className="max-w-6xl mx-auto py-10 px-4 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="h-6 w-6" /> Agents / Sandbox
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            管理沙箱脚本，定时调用 MCP 任务并查看运行记录。
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>接口访问密钥</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <Input
              value={apiToken}
              placeholder="Bearer Token"
              onChange={(event) => setApiToken(event.target.value)}
            />
            <div className="flex gap-2">
              <Button onClick={saveTokenLocally} variant="secondary">
                保存本地
              </Button>
              <Button onClick={loadScripts} disabled={loading || !apiToken}>
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "重新加载"}
              </Button>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">沙箱脚本列表</h2>
        <Button onClick={openCreateForm}>新建脚本</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scripts.map((script) => (
          <Card key={script.id} className={selectedScriptId === script.id ? "border-primary" : ""}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{script.name}</CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedScriptId(script.id);
                      loadRuns(script.id);
                    }}
                  >
                    查看
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEditForm(script)}>
                    编辑
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => deleteScript(script.id)}>
                    删除
                  </Button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground break-all">{script.entryFile}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {script.description && (
                <p className="text-sm text-muted-foreground">{script.description}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  {script.scheduleMs ? `定时 ${Math.round(script.scheduleMs / 1000)}s` : "无定时"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {isFormVisible && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>{form.mode === "create" ? "新建脚本" : `编辑 ${form.name}`}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">名称</label>
                <Input
                  value={form.name}
                  onChange={(event) => handleFormChange({ name: event.target.value })}
                  disabled={form.mode === "edit"}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">定时 (毫秒，0 表示关闭)</label>
                <Input
                  type="number"
                  value={form.scheduleMs ?? 0}
                  onChange={(event) =>
                    handleFormChange({ scheduleMs: Number(event.target.value) || null })
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">入口文件 (绝对路径)</label>
                <Input
                  value={form.entryFile}
                  onChange={(event) => handleFormChange({ entryFile: event.target.value })}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">描述</label>
                <Textarea
                  value={form.description}
                  onChange={(event) => handleFormChange({ description: event.target.value })}
                  rows={3}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">环境变量 (JSON)</label>
                <Textarea
                  value={form.envJson}
                  onChange={(event) => handleFormChange({ envJson: event.target.value })}
                  rows={6}
                />
              </div>
            </div>
            <Separator />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFormVisible(false)}>
                取消
              </Button>
              <Button onClick={submitScriptForm}>{form.mode === "create" ? "创建" : "保存"}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedScript && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">运行记录 · {selectedScript.name}</CardTitle>
                <p className="text-xs text-muted-foreground">最近 10 次执行</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadRuns(selectedScript.id)}
                  disabled={runLoading}
                >
                  <RefreshCw className={`h-4 w-4 ${runLoading ? 'animate-spin' : ''}`} />
                  <span className="ml-1">刷新</span>
                </Button>
                <Button
                  size="sm"
                  onClick={() => triggerRun(selectedScript.id)}
                  disabled={runLoading}
                >
                  {runLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  <span className="ml-2">手动执行</span>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {runs.length === 0 && (
              <p className="text-sm text-muted-foreground">暂无运行记录</p>
            )}
            {runs.map((run) => (
              <div key={run.runId} className="border rounded-md p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <div className="flex gap-2 items-center">
                    <Badge variant={run.status === "success" ? "secondary" : "destructive"}>
                      {run.status === "success" ? "成功" : "失败"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(run.startedAt).toLocaleString()} · {formatDuration(run.durationMs)} ·
                      {" "}
                      {run.trigger === "schedule" ? "定时" : "手动"}
                    </span>
                  </div>
                  {run.actor && (
                    <span className="text-xs text-muted-foreground">触发：{run.actor}</span>
                  )}
                </div>
                {run.error ? (
                  <p className="text-sm text-destructive">错误：{run.error}</p>
                ) : (
                  <p className="text-sm whitespace-pre-wrap break-words max-h-40 overflow-auto">
                    {run.output || "(无输出)"}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
