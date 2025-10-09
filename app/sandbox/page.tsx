"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getMcpEndpoint } from "@/lib/apiConfig";
import { getStoredApiToken, setStoredApiToken } from "@/lib/authToken";
import { PlusCircle, RefreshCw, Settings2, Trash2 } from "lucide-react";

interface SandboxEnvironment {
  id: string;
  name: string;
  description?: string;
  variables: Record<string, string>;
}

type KeyValueRow = {
  id: string;
  key: string;
  value: string;
};

type EnvironmentFormState = {
  mode: "create" | "edit";
  id?: string;
  name: string;
  description: string;
  rows: KeyValueRow[];
};

const DEFAULT_ENVIRONMENT_NAME = "默认虚拟环境";
const createRowId = () => Math.random().toString(36).slice(2, 10);

const createEmptyForm = (): EnvironmentFormState => ({
  mode: "create",
  name: "",
  description: "",
  rows: [
    { id: createRowId(), key: "", value: "" },
  ],
});

const mapVariablesToRows = (variables: Record<string, string>): KeyValueRow[] => {
  const entries = Object.entries(variables);
  if (!entries.length) {
    return [{ id: createRowId(), key: "", value: "" }];
  }
  return entries.map(([key, value]) => ({
    id: createRowId(),
    key,
    value,
  }));
};

const rowsToVariables = (rows: KeyValueRow[]): Record<string, string> => {
  const variables: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    variables[key] = row.value;
  }
  return variables;
};

export default function SandboxPage() {
  const [apiToken, setApiToken] = useState("");
  const [environments, setEnvironments] = useState<SandboxEnvironment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<EnvironmentFormState>(createEmptyForm);
  const [isFormVisible, setFormVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const stored = getStoredApiToken();
    if (stored) {
      setApiToken(stored);
    }
  }, []);

  useEffect(() => {
    if (apiToken) {
      loadEnvironments();
    }
  }, [apiToken]);

  const authorizedHeaders = useMemo(() => {
    if (!apiToken) return undefined;
    return {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    } as Record<string, string>;
  }, [apiToken]);

  const loadEnvironments = async () => {
    if (!apiToken) {
      setError("请先配置 API Token");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(getMcpEndpoint("/sandbox/environments"), {
        headers: authorizedHeaders,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `加载失败 (${response.status})`);
      }
      const data = (await response.json()) as { environments: SandboxEnvironment[] };
      setEnvironments(
        data.environments?.map((env) => ({
          ...env,
          variables: env.variables ?? {},
        })) ?? []
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const saveTokenLocally = () => {
    setStoredApiToken(apiToken);
  };

  const openCreateForm = () => {
    setForm(createEmptyForm());
    setFormVisible(true);
  };

  const openEditForm = (environment: SandboxEnvironment) => {
    setForm({
      mode: "edit",
      id: environment.id,
      name: environment.name,
      description: environment.description ?? "",
      rows: mapVariablesToRows(environment.variables ?? {}),
    });
    setFormVisible(true);
  };

  const handleRowChange = (rowId: string, partial: Partial<KeyValueRow>) => {
    setForm((prev) => ({
      ...prev,
      rows: prev.rows.map((row) =>
        row.id === rowId ? { ...row, ...partial } : row
      ),
    }));
  };

  const addRow = () => {
    setForm((prev) => ({
      ...prev,
      rows: [...prev.rows, { id: createRowId(), key: "", value: "" }],
    }));
  };

  const removeRow = (rowId: string) => {
    setForm((prev) => {
      const filtered = prev.rows.filter((row) => row.id !== rowId);
      return {
        ...prev,
        rows: filtered.length ? filtered : [{ id: createRowId(), key: "", value: "" }],
      };
    });
  };

  const submitForm = async () => {
    if (!apiToken) {
      setError("请先配置 API Token");
      return;
    }
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setError("名称为必填项");
      return;
    }
    const variables = rowsToVariables(form.rows);

    if (Object.keys(variables).some((key) => /\s/.test(key))) {
      setError("变量名不支持空格，请使用字母、数字或下划线。");
      return;
    }

    const payload: Record<string, unknown> = {
      name: trimmedName,
      description: form.description.trim() || undefined,
      variables,
    };

    const endpoint =
      form.mode === "create"
        ? getMcpEndpoint("/sandbox/environments")
        : getMcpEndpoint(`/sandbox/environments/${encodeURIComponent(form.id!)}`);
    const method = form.mode === "create" ? "POST" : "PATCH";

    setSaving(true);
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
      setFormVisible(false);
      await loadEnvironments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const deleteEnvironment = async (environmentId: string) => {
    if (!apiToken) return;
    if (!window.confirm("确定删除该虚拟环境？如仍被脚本引用将无法删除。")) return;

    setDeletingId(environmentId);
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
      await loadEnvironments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  const defaultEnvironmentId = useMemo(() => {
    return environments.find((env) => env.name === DEFAULT_ENVIRONMENT_NAME)?.id ?? null;
  }, [environments]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Settings2 className="h-6 w-6" /> 沙箱虚拟环境
          </h1>
          <p className="text-sm text-muted-foreground">
            集中管理可复用的运行时变量，创建后可在 Agents 沙箱脚本中一键引用。
          </p>
        </div>
        <Button onClick={openCreateForm}>
          <PlusCircle className="mr-2 h-4 w-4" /> 新建虚拟环境
        </Button>
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
              <Button onClick={loadEnvironments} disabled={loading || !apiToken}>
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "重新加载"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            若尚未配置，将默认创建一个空白虚拟环境，可直接在脚本页面引用。
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">环境列表</CardTitle>
        </CardHeader>
        <CardContent>
          {environments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              暂无虚拟环境，请点击右上角按钮新建。
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {environments.map((environment) => {
                const variableEntries = Object.entries(environment.variables ?? {});
                const isDefault = environment.id === defaultEnvironmentId;
                return (
                  <Card key={environment.id} className="border">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-base">{environment.name}</CardTitle>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs">
                            <Badge variant="secondary">变量 {variableEntries.length}</Badge>
                            {isDefault && <Badge variant="outline">默认</Badge>}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditForm(environment)}
                          >
                            编辑
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deleteEnvironment(environment.id)}
                            disabled={deletingId === environment.id}
                          >
                            {deletingId === environment.id ? (
                              <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                      {environment.description && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {environment.description}
                        </p>
                      )}
                    </CardHeader>
                    <CardContent>
                      {variableEntries.length === 0 ? (
                        <p className="text-xs text-muted-foreground">无变量，引用时仅提供空环境。</p>
                      ) : (
                        <ScrollArea className="h-32 rounded border bg-muted/40 p-3">
                          <div className="space-y-2 text-xs">
                            {variableEntries.map(([key, value]) => (
                              <div key={key} className="flex flex-col">
                                <span className="font-medium">{key}</span>
                                <span className="text-muted-foreground break-all">{value}</span>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {isFormVisible && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>
              {form.mode === "create" ? "新建虚拟环境" : `编辑 ${form.name}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">名称</label>
                <Input
                  value={form.name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder="如：生产环境变量"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">描述</label>
                <Input
                  value={form.description}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, description: event.target.value }))
                  }
                  placeholder="可选，说明用途"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">变量列表</label>
                <Button type="button" size="sm" variant="outline" onClick={addRow}>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  新增变量
                </Button>
              </div>

              <div className="space-y-3">
                {form.rows.map((row) => (
                  <div key={row.id} className="grid gap-2 md:grid-cols-5">
                    <Input
                      className="md:col-span-2"
                      value={row.key}
                      placeholder="变量名"
                      onChange={(event) =>
                        handleRowChange(row.id, { key: event.target.value })
                      }
                    />
                    <Input
                      className="md:col-span-3"
                      value={row.value}
                      placeholder="变量值（保存后后端存储为纯文本）"
                      onChange={(event) =>
                        handleRowChange(row.id, { value: event.target.value })
                      }
                    />
                    <div className="md:col-span-5 flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => removeRow(row.id)}
                        disabled={form.rows.length === 1 && !row.key && !row.value}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">删除变量</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                变量名仅支持字母、数字、下划线。保存后可在 Agents 沙箱脚本中绑定该环境，脚本内同名键会覆盖默认值。
              </p>
            </div>

            <Separator />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFormVisible(false)}>
                取消
              </Button>
              <Button onClick={submitForm} disabled={saving}>
                {saving ? "保存中..." : "保存虚拟环境"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
