"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getMcpEndpoint } from "@/lib/apiConfig";
import { getStoredApiToken, onApiTokenChange, setStoredApiToken } from "@/lib/authToken";
import { Plug, RefreshCw } from "lucide-react";

interface ServiceRecord {
  name: string;
  baseUrl: string;
  description?: string;
  capabilities: string[];
  authToken?: string;
  timeoutMs?: number;
  allowedRoles?: string[] | null;
}

const roleOptions = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "operator", label: "Operator" },
  { value: "viewer", label: "Viewer" },
];

const capabilityOptions = [
  { value: "tools", label: "工具" },
  { value: "files", label: "文件" },
  { value: "secrets", label: "秘钥" },
  { value: "events", label: "事件" },
];

type FormState = {
  mode: "create" | "edit";
  originalName?: string;
  name: string;
  baseUrl: string;
  description: string;
  capabilities: string[];
  authToken: string;
  timeoutMs: number;
  allowedRoles: string[];
};

const createEmptyForm = (): FormState => ({
  mode: "create",
  name: "",
  baseUrl: "",
  description: "",
  capabilities: ["tools"],
  authToken: "",
  timeoutMs: 30000,
  allowedRoles: [],
});

const normalizeRoles = (roles: string[] | undefined | null) => {
  if (!roles) return [];
  return roles.filter((role) => roleOptions.some((opt) => opt.value === role));
};

export default function IntegrationsPage() {
  const [apiToken, setApiToken] = useState("");
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(createEmptyForm);
  const [isFormVisible, setFormVisible] = useState(false);

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

  useEffect(() => {
    if (apiToken) {
      fetchServices();
    }
  }, [apiToken]);

  const authorizedHeaders = useMemo(() => {
    if (!apiToken) return undefined;
    return {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    } as Record<string, string>;
  }, [apiToken]);

  const fetchServices = async () => {
    if (!apiToken) {
      setError("请先配置 API Token");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const response = await fetch(getMcpEndpoint("/registry"), {
        method: "GET",
        headers: authorizedHeaders,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `加载失败 (${response.status})`);
      }
      const data = (await response.json()) as { services: ServiceRecord[] };
      setServices(data.services ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const openCreateForm = () => {
    setForm(createEmptyForm());
    setFormVisible(true);
  };

  const openEditForm = (service: ServiceRecord) => {
    setForm({
      mode: "edit",
      originalName: service.name,
      name: service.name,
      baseUrl: service.baseUrl,
      description: service.description ?? "",
      capabilities: service.capabilities ?? [],
      authToken: service.authToken ?? "",
      timeoutMs: service.timeoutMs ?? 30000,
      allowedRoles: normalizeRoles(service.allowedRoles),
    });
    setFormVisible(true);
  };

  const toggleListValue = (values: string[], value: string) => {
    return values.includes(value)
      ? values.filter((item) => item !== value)
      : [...values, value];
  };

  const handleFormChange = (key: keyof FormState, value: unknown) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const submitForm = async () => {
    if (!apiToken) {
      setError("请先配置 API Token");
      return;
    }

    if (!form.name.trim() || !form.baseUrl.trim()) {
      setError("名称与 Base URL 为必填项");
      return;
    }

    const payload: Partial<McpServerConfig> & { allowedRoles?: string[] } = {
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      description: form.description.trim() || undefined,
      capabilities: form.capabilities,
      authToken: form.authToken.trim() || undefined,
      timeoutMs: form.timeoutMs,
      allowedRoles: form.allowedRoles.length ? form.allowedRoles : undefined,
    };

    try {
      const endpoint =
        form.mode === "create"
          ? getMcpEndpoint("/registry")
          : getMcpEndpoint(`/registry/${encodeURIComponent(form.originalName ?? form.name)}`);
      const method = form.mode === "create" ? "POST" : "PATCH";

      const response = await fetch(endpoint, {
        method,
        headers: authorizedHeaders,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `${form.mode === "create" ? "创建" : "更新"}失败`);
      }

      setFormVisible(false);
      await fetchServices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  };

  const deleteService = async (name: string) => {
    if (!apiToken) return;
    const confirmed = window.confirm(`确认删除服务 ${name} ?`);
    if (!confirmed) return;

    try {
      const response = await fetch(getMcpEndpoint(`/registry/${encodeURIComponent(name)}`), {
        method: "DELETE",
        headers: authorizedHeaders,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "删除失败");
      }
      await fetchServices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  };

  const saveTokenLocally = () => {
    setStoredApiToken(apiToken);
  };

  return (
    <div className="max-w-5xl mx-auto py-10 px-4 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Plug className="h-6 w-6" /> 集成与网关
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            注册 MCP 服务、配置访问权限，并统一通过 MCP over HTTPS 进行调用
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
              <Button onClick={fetchServices} disabled={loading || !apiToken}>
                {loading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  "重新加载"
                )}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Token 将保存在浏览器本地存储中，仅用于向后端发送受保护请求。
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">已注册服务</h2>
        <Button onClick={openCreateForm}>新建服务</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {services.map((service) => (
          <Card key={service.name} className="flex flex-col justify-between">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{service.name}</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEditForm(service)}>
                    编辑
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => deleteService(service.name)}>
                    删除
                  </Button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground break-all">{service.baseUrl}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {service.description && (
                <p className="text-sm text-muted-foreground">{service.description}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {service.capabilities?.map((cap) => (
                  <Badge key={cap} variant="secondary">
                    {cap}
                  </Badge>
                ))}
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Timeout: {service.timeoutMs ?? 30000} ms</div>
                <div>
                  允许角色：
                  {service.allowedRoles && service.allowedRoles.length ? (
                    service.allowedRoles.join(", ")
                  ) : (
                    <span className="italic">不限</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {isFormVisible && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>{form.mode === "create" ? "新建服务" : `编辑 ${form.originalName}`}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">名称</label>
                <Input
                  value={form.name}
                  disabled={form.mode === "edit"}
                  onChange={(event) => handleFormChange("name", event.target.value)}
                  placeholder="唯一标识"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">超时 (ms)</label>
                <Input
                  type="number"
                  value={form.timeoutMs}
                  onChange={(event) => handleFormChange("timeoutMs", Number(event.target.value))}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Base URL</label>
                <Input
                  value={form.baseUrl}
                  onChange={(event) => handleFormChange("baseUrl", event.target.value)}
                  placeholder="https://example.com"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">描述</label>
                <Textarea
                  value={form.description}
                  onChange={(event) => handleFormChange("description", event.target.value)}
                  rows={3}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Capabilities</label>
                <div className="flex flex-wrap gap-3">
                  {capabilityOptions.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.capabilities.includes(option.value)}
                        onChange={() =>
                          handleFormChange(
                            "capabilities",
                            toggleListValue(form.capabilities, option.value)
                          )
                        }
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">允许角色</label>
                <p className="text-xs text-muted-foreground">
                  留空表示全部角色可访问；仅限 Owner/Admin/Operator/Viewer。
                </p>
                <div className="flex flex-wrap gap-3">
                  {roleOptions.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.allowedRoles.includes(option.value)}
                        onChange={() =>
                          handleFormChange(
                            "allowedRoles",
                            toggleListValue(form.allowedRoles, option.value)
                          )
                        }
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">下游服务 Token</label>
                <Input
                  value={form.authToken}
                  onChange={(event) => handleFormChange("authToken", event.target.value)}
                  placeholder="可选，调用时附带"
                />
              </div>
            </div>

            <Separator />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFormVisible(false)}>
                取消
              </Button>
              <Button onClick={submitForm}>{form.mode === "create" ? "创建" : "保存"}</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface McpServerConfig {
  name: string;
  baseUrl: string;
  description?: string;
  capabilities: string[];
  authToken?: string;
  timeoutMs?: number;
  allowedRoles?: string[];
}
