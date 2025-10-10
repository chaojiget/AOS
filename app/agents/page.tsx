"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getMcpEndpoint } from "@/lib/apiConfig";
import { getStoredApiToken, onApiTokenChange, setStoredApiToken } from "@/lib/authToken";
import { Cpu, Play, RefreshCw } from "lucide-react";

interface SandboxEnvironmentSummary {
  id: string;
  name: string;
  description?: string;
}

interface SandboxScript {
  id: string;
  name: string;
  entryFile: string;
  description?: string;
  scheduleMs?: number | null;
  env?: Record<string, string>;
  environmentId?: string | null;
  environment?: SandboxEnvironmentSummary | null;
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
  environmentId: string | null;
  envJson: string;
  content: string;
  contentTouched: boolean;
};

interface SandboxEnvironment {
  id: string;
  name: string;
  description?: string;
  variables: Record<string, string>;
}

type EnvironmentFormState = {
  mode: "create" | "edit";
  id?: string;
  name: string;
  description: string;
  variablesJson: string;
};

const DEFAULT_SCRIPT_TEMPLATE = `export async function run() {
  console.log('Sandbox script executed at', new Date().toISOString());
}
`;

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || "sandbox-script";

const createDefaultScriptForm = (): ScriptFormState => ({
  mode: "create",
  name: "",
  entryFile: "",
  description: "",
  scheduleMs: null,
  environmentId: null,
  envJson: "{}",
  content: DEFAULT_SCRIPT_TEMPLATE,
  contentTouched: false,
});

const createDefaultEnvironmentForm = (): EnvironmentFormState => ({
  mode: "create",
  name: "",
  description: "",
  variablesJson: "{}",
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
  const [environments, setEnvironments] = useState<SandboxEnvironment[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [runs, setRuns] = useState<SandboxRunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [envLoading, setEnvLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ScriptFormState>(createDefaultScriptForm);
  const [environmentForm, setEnvironmentForm] = useState<EnvironmentFormState>(createDefaultEnvironmentForm);
  const [isFormVisible, setFormVisible] = useState(false);
  const [isEnvironmentFormVisible, setEnvironmentFormVisible] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [environmentSaving, setEnvironmentSaving] = useState(false);

  const suggestedEntry = useMemo(() => {
    if (!form.name.trim()) {
      return "sandbox-scripts/my-script.mjs";
    }
    return `sandbox-scripts/${slugify(form.name)}.mjs`;
  }, [form.name]);

  useEffect(() => {
    const stored = getStoredApiToken();
    setApiToken(stored ?? "");

    const unsubscribe = onApiTokenChange((token) => {
      setApiToken(token ?? "");
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const authorizedHeaders = useMemo(() => {
    if (!apiToken) return undefined;
    return {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    } as Record<string, string>;
  }, [apiToken]);

  const loadEnvironments = useCallback(async () => {
    if (!apiToken) {
      setError("请先配置 API Token");
      return;
    }
    setEnvLoading(true);
    setError(null);
    try {
      const response = await fetch(getMcpEndpoint("/sandbox/environments"), {
        headers: authorizedHeaders,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `加载失败 (${response.status})`);
      }
      const data = (await response.json()) as { environments: Array<SandboxEnvironment & { variables?: Record<string, string> }> };
      const normalized =
        data.environments?.map((item) => ({
          ...item,
          variables: item.variables ?? {},
        })) ?? [];
      setEnvironments(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setEnvLoading(false);
    }
  }, [apiToken, authorizedHeaders]);

  const loadScripts = useCallback(async () => {
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
      const normalized =
        data.scripts?.map((script) => ({
          ...script,
          environmentId:
            script.environmentId ?? (script.environment ? script.environment.id : null),
        })) ?? [];
      setScripts(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [apiToken, authorizedHeaders]);

  const reloadSandboxData = useCallback(async () => {
    await loadEnvironments();
    await loadScripts();
  }, [loadEnvironments, loadScripts]);

  const loadRuns = useCallback(async (scriptId: string) => {
    if (!apiToken) {
      setError("请先配置 API Token");
      return;
    }
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
  }, [apiToken, authorizedHeaders]);

  useEffect(() => {
    if (apiToken && selectedScriptId) {
      loadRuns(selectedScriptId);
    }
  }, [apiToken, selectedScriptId, loadRuns]);

  useEffect(() => {
    if (!apiToken) return;
    reloadSandboxData();
  }, [apiToken, reloadSandboxData]);

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
      environmentId: script.environmentId ?? script.environment?.id ?? null,
      envJson: JSON.stringify(script.env ?? {}, null, 2),
      content: "",
      contentTouched: false,
    });
    setFormVisible(true);
  };

  const handleFormChange = (partial: Partial<ScriptFormState>) => {
    setForm((prev) => ({
      ...prev,
      ...partial,
      contentTouched:
        partial.content !== undefined ? true : partial.contentTouched ?? prev.contentTouched,
    }));
  };

  const openEnvironmentCreateForm = () => {
    setEnvironmentForm(createDefaultEnvironmentForm());
    setEnvironmentFormVisible(true);
  };

  const openEnvironmentEditForm = (environment: SandboxEnvironment) => {
    setEnvironmentForm({
      mode: "edit",
      id: environment.id,
      name: environment.name,
      description: environment.description ?? "",
      variablesJson: JSON.stringify(environment.variables ?? {}, null, 2),
    });
    setEnvironmentFormVisible(true);
  };

  const handleEnvironmentFormChange = (partial: Partial<EnvironmentFormState>) => {
    setEnvironmentForm((prev) => ({
      ...prev,
      ...partial,
    }));
  };

  const submitEnvironmentForm = async () => {
    if (!apiToken) {
      setError("请先配置 API Token");
      return;
    }
    const trimmedName = environmentForm.name.trim();
    if (!trimmedName) {
      setError("虚拟环境名称为必填项");
      return;
    }

    let variables: Record<string, string> = {};
    const variablesInput = environmentForm.variablesJson.trim();
    if (variablesInput) {
      try {
        variables = safeJsonParse(variablesInput);
      } catch (err) {
        setError(err instanceof Error ? err.message : "变量 JSON 解析失败");
        return;
      }
    }

    const payload: Record<string, unknown> = {
      name: trimmedName,
      description: environmentForm.description.trim() || undefined,
      variables,
    };

    const endpoint =
      environmentForm.mode === "create"
        ? getMcpEndpoint("/sandbox/environments")
        : getMcpEndpoint(`/sandbox/environments/${encodeURIComponent(environmentForm.id!)}`);
    const method = environmentForm.mode === "create" ? "POST" : "PATCH";

    setEnvironmentSaving(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method,
        headers: authorizedHeaders,
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "保存虚拟环境失败");
      }
      setEnvironmentFormVisible(false);
      await loadEnvironments();
      await loadScripts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setEnvironmentSaving(false);
    }
  };

  const deleteEnvironment = async (environmentId: string) => {
    if (!apiToken) return;
    if (!window.confirm("确定删除该虚拟环境？如仍被脚本引用将无法删除。")) return;
    try {
      const response = await fetch(
        getMcpEndpoint(`/sandbox/environments/${encodeURIComponent(environmentId)}`),
        {
          method: "DELETE",
          headers: authorizedHeaders,
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "删除失败");
      }
      if (form.environmentId === environmentId) {
        setForm((prev) => ({
          ...prev,
          environmentId: null,
        }));
      }
      await loadEnvironments();
      await loadScripts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  };

  const submitScriptForm = async () => {
    if (!apiToken) {
      setError("请先配置 API Token");
      return;
    }
    const trimmedName = form.name.trim();
    const trimmedEntry = form.entryFile.trim();
    const trimmedContent = form.content.trim();

    if (!trimmedName) {
      setError("名称为必填项");
      return;
    }
    if (form.mode === "create" && !trimmedEntry && !trimmedContent) {
      setError("请填写入口文件或提供脚本内容");
      return;
    }

    let env: Record<string, string> | undefined;
    if (form.envJson.trim()) {
      env = safeJsonParse(form.envJson.trim());
    }

    const payload: Record<string, unknown> = {
      name: trimmedName,
      description: form.description.trim() || undefined,
      scheduleMs: form.scheduleMs ?? null,
      env,
      environmentId: form.environmentId ?? null,
    };

    if (trimmedEntry) {
      payload.entryFile = trimmedEntry;
    }

    if (form.mode === "create") {
      if (trimmedContent) {
        payload.content = trimmedContent;
      }
    } else if (form.contentTouched && trimmedContent) {
      payload.content = trimmedContent;
    }

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
  const selectedScriptEnvironment =
    selectedScript?.environmentId
      ? environments.find((env) => env.id === selectedScript.environmentId) ??
        (selectedScript.environment
          ? {
              id: selectedScript.environment.id,
              name: selectedScript.environment.name,
              description: selectedScript.environment.description,
              variables: {},
            }
          : null)
      : null;
  const currentFormEnvironment =
    form.environmentId ? environments.find((env) => env.id === form.environmentId) ?? null : null;
  const isSelectedEnvironmentMissing =
    !!selectedScript?.environmentId && !selectedScriptEnvironment;

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
              <Button onClick={reloadSandboxData} disabled={loading || envLoading || !apiToken}>
                {loading || envLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  "重新加载"
                )}
              </Button>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-lg">虚拟环境</CardTitle>
            <p className="text-sm text-muted-foreground">
              预先配置运行时变量，实现脚本间复用与隔离；系统已自动创建一份空白默认环境，可直接使用或前往「沙箱」页面集中管理。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadEnvironments}
              disabled={envLoading || !apiToken}
            >
              <RefreshCw className={`h-4 w-4 ${envLoading ? "animate-spin" : ""}`} />
              <span className="ml-1">刷新</span>
            </Button>
            <Link href="/sandbox">
              <Button size="sm" variant="secondary">
                打开沙箱页面
              </Button>
            </Link>
            <Button size="sm" onClick={openEnvironmentCreateForm}>
              新建虚拟环境
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {environments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              暂无虚拟环境，创建后可供沙箱脚本引用。
            </p>
          ) : (
            <div className="space-y-3">
              {environments.map((environment) => {
                const variableKeys = Object.keys(environment.variables ?? {});
                return (
                  <div key={environment.id} className="rounded-lg border p-3 space-y-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{environment.name}</span>
                          <Badge variant="secondary">变量 {variableKeys.length}</Badge>
                        </div>
                        {environment.description && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {environment.description}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEnvironmentEditForm(environment)}
                        >
                          编辑
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteEnvironment(environment.id)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                    {variableKeys.length > 0 && (
                      <div className="flex flex-wrap gap-2 text-xs">
                        {variableKeys.slice(0, 4).map((key) => (
                          <Badge key={key} variant="outline">
                            {key}
                          </Badge>
                        ))}
                        {variableKeys.length > 4 && (
                          <Badge variant="outline">+{variableKeys.length - 4}</Badge>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {isEnvironmentFormVisible && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>
              {environmentForm.mode === "create" ? "新建虚拟环境" : `编辑 ${environmentForm.name}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">名称</label>
                <Input
                  value={environmentForm.name}
                  onChange={(event) => handleEnvironmentFormChange({ name: event.target.value })}
                  placeholder="如：本地调试环境"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">描述</label>
                <Input
                  value={environmentForm.description}
                  onChange={(event) =>
                    handleEnvironmentFormChange({ description: event.target.value })
                  }
                  placeholder="可选，说明用途"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">变量定义 (JSON)</label>
                <Textarea
                  value={environmentForm.variablesJson}
                  onChange={(event) =>
                    handleEnvironmentFormChange({ variablesJson: event.target.value })
                  }
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">
                  只支持键值对格式，例如 {"{ \"API_KEY\": \"value\" }"}。脚本执行时将与脚本
                  Env 合并，脚本覆盖同名键。
                </p>
              </div>
            </div>
            <Separator />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEnvironmentFormVisible(false)}>
                取消
              </Button>
              <Button onClick={submitEnvironmentForm} disabled={environmentSaving}>
                {environmentSaving ? "保存中..." : "保存虚拟环境"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
                {script.environmentId && (
                  <Badge variant="outline">
                    虚拟环境：{script.environment?.name ?? "已删除"}
                  </Badge>
                )}
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
                <label className="text-sm font-medium">入口文件</label>
                <div className="flex gap-2">
                  <Input
                    value={form.entryFile}
                    onChange={(event) => handleFormChange({ entryFile: event.target.value })}
                    placeholder={suggestedEntry}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleFormChange({ entryFile: suggestedEntry })}
                  >
                    使用建议
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  可填写绝对路径，或使用相对于 <code>sandbox-scripts</code> 目录的相对路径。
                  留空将自动保存为 <code>{suggestedEntry}</code>。
                </p>
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
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">脚本内容 (可选)</label>
                  {form.mode === "create" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => handleFormChange({ content: DEFAULT_SCRIPT_TEMPLATE })}
                    >
                      填充示例
                    </Button>
                  )}
                </div>
                <Textarea
                  value={form.content}
                  onChange={(event) => handleFormChange({ content: event.target.value })}
                  rows={8}
                  placeholder={`export async function run() {\n  console.log('hello');\n}`}
                />
                <p className="text-xs text-muted-foreground">
                  新建脚本时可直接在此编写内容；留空则需确保入口文件已存在。
                  编辑脚本时若需更新文件，请在此粘贴最新内容。
                </p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">虚拟环境</label>
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.environmentId ?? ""}
                    onChange={(event) =>
                      handleFormChange({
                        environmentId: event.target.value ? event.target.value : null,
                      })
                    }
                  >
                    <option value="">不绑定</option>
                    {environments.map((environment) => (
                      <option key={environment.id} value={environment.id}>
                        {environment.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openEnvironmentCreateForm}
                  >
                    新建虚拟环境
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  绑定虚拟环境后自动注入对应变量，脚本中的环境变量 JSON 将覆盖同名键。
                </p>
                {form.environmentId && currentFormEnvironment && (
                  <p className="text-xs text-muted-foreground">
                    当前选择：{currentFormEnvironment.name} · 变量{" "}
                    {Object.keys(currentFormEnvironment.variables ?? {}).length}
                  </p>
                )}
                {form.environmentId && !currentFormEnvironment && (
                  <p className="text-xs text-destructive">
                    当前绑定的虚拟环境不存在，请重新选择。
                  </p>
                )}
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
                <p className="text-xs text-muted-foreground mt-1">
                  虚拟环境：
                  {isSelectedEnvironmentMissing
                    ? "绑定的虚拟环境已删除"
                    : selectedScriptEnvironment
                    ? `${selectedScriptEnvironment.name} · 变量 ${Object.keys(
                        selectedScriptEnvironment.variables ?? {}
                      ).length}`
                    : "未绑定"}
                </p>
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
