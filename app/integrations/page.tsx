"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getMcpEndpoint } from "@/lib/apiConfig";
import { getStoredApiToken, onApiTokenChange, setStoredApiToken } from "@/lib/authToken";
import { AlertTriangle, Plug, RefreshCw } from "lucide-react";

type HealthState = "healthy" | "degraded" | "unreachable";

interface McpServiceStatus {
  name: string;
  health: HealthState;
  message?: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastCheckedAt?: string;
  lastManualCheck?: {
    status: HealthState;
    latencyMs?: number;
    message?: string;
    checkedAt: string;
  };
  metrics: {
    totalCalls: number;
    successCount: number;
    failureCount: number;
    errorRate: number;
    p50Latency?: number;
    p95Latency?: number;
    consecutiveFailures: number;
  };
  policy: {
    quota?: {
      limitPerMinute?: number;
      burstMultiplier?: number;
    };
    circuitBreaker?: {
      failureThreshold: number;
      cooldownSeconds: number;
      minimumSamples?: number;
    };
  };
  quota: {
    limitPerMinute?: number;
    currentUsage: number;
    burstMultiplier: number;
  };
  circuit: {
    open: boolean;
    releaseAt?: string;
  };
}

interface ServiceRecord {
  name: string;
  baseUrl: string;
  description?: string;
  capabilities: string[];
  authToken?: string;
  timeoutMs?: number;
  allowedRoles?: string[] | null;
  status?: McpServiceStatus;
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
  { value: "secrets", label: "密钥" },
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

interface PolicyFormState {
  quotaLimitPerMinute: string;
  quotaBurstMultiplier: string;
  circuitFailureThreshold: string;
  circuitCooldownSeconds: string;
  circuitMinimumSamples: string;
}

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
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [policyForms, setPolicyForms] = useState<Record<string, PolicyFormState>>({});
  const [policyErrors, setPolicyErrors] = useState<Record<string, string | null>>({});
  const [healthErrors, setHealthErrors] = useState<Record<string, string | null>>({});
  const [policySaving, setPolicySaving] = useState<string | null>(null);
  const [checkingService, setCheckingService] = useState<string | null>(null);

  const healthText: Record<HealthState, string> = {
    healthy: "健康",
    degraded: "性能下降",
    unreachable: "不可达",
  };

  const healthClass: Record<HealthState, string> = {
    healthy: "bg-emerald-100 text-emerald-700 border border-emerald-200",
    degraded: "bg-amber-100 text-amber-700 border border-amber-200",
    unreachable: "bg-red-100 text-red-700 border border-red-200",
  };

  const buildPolicyForm = (status?: McpServiceStatus): PolicyFormState => ({
    quotaLimitPerMinute:
      status?.policy.quota?.limitPerMinute != null ? String(status.policy.quota.limitPerMinute) : "",
    quotaBurstMultiplier:
      status?.policy.quota?.burstMultiplier != null ? String(status.policy.quota.burstMultiplier) : "1.2",
    circuitFailureThreshold:
      status?.policy.circuitBreaker?.failureThreshold != null
        ? String(status.policy.circuitBreaker.failureThreshold)
        : "3",
    circuitCooldownSeconds:
      status?.policy.circuitBreaker?.cooldownSeconds != null
        ? String(status.policy.circuitBreaker.cooldownSeconds)
        : "60",
    circuitMinimumSamples:
      status?.policy.circuitBreaker?.minimumSamples != null
        ? String(status.policy.circuitBreaker.minimumSamples)
        : "5",
  });

  const formatTime = (value?: string) => {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  };

  const formatLatency = (value?: number) => {
    if (value == null) return "—";
    return `${Math.round(value)} ms`;
  };

  const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

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
    setPolicyForms((prev) => {
      const next = { ...prev } as Record<string, PolicyFormState>;
      let changed = false;
      const names = new Set(services.map((service) => service.name));
      for (const service of services) {
        if (!next[service.name]) {
          next[service.name] = buildPolicyForm(service.status);
          changed = true;
        }
      }
      for (const key of Object.keys(next)) {
        if (!names.has(key)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [services]);

  useEffect(() => {
    if (expandedService && !services.some((service) => service.name === expandedService)) {
      setExpandedService(null);
    }
  }, [services, expandedService]);

  const authorizedHeaders = useMemo(() => {
    if (!apiToken) return undefined;
    return {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    } as Record<string, string>;
  }, [apiToken]);

  const fetchServices = useCallback(async () => {
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
      const data = (await response.json().catch(() => ({}))) as {
        services?: ServiceRecord[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? `加载失败 (${response.status})`);
      }
      setServices(data.services ?? []);
      setHealthErrors({});
      setPolicyErrors({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [apiToken, authorizedHeaders]);

  useEffect(() => {
    if (apiToken) {
      fetchServices();
    }
  }, [apiToken, fetchServices]);

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

  const togglePolicySection = (service: ServiceRecord) => {
    setPolicyErrors((prev) => ({ ...prev, [service.name]: null }));
    setExpandedService((prev) => (prev === service.name ? null : service.name));
    setPolicyForms((prev) => ({
      ...prev,
      [service.name]: prev[service.name] ?? buildPolicyForm(service.status),
    }));
  };

  const updatePolicyField = (
    serviceName: string,
    field: keyof PolicyFormState,
    value: string,
  ) => {
    setPolicyForms((prev) => {
      const next = { ...prev } as Record<string, PolicyFormState>;
      const currentStatus = services.find((item) => item.name === serviceName)?.status;
      next[serviceName] = {
        ...(next[serviceName] ?? buildPolicyForm(currentStatus)),
        [field]: value,
      } as PolicyFormState;
      return next;
    });
  };

  const parseNumberInput = (value: string): number | undefined => {
    if (!value || !value.trim()) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error("请输入合法的数值");
    }
    return parsed;
  };

  const savePolicy = async (service: ServiceRecord) => {
    if (!apiToken) {
      setError("请先配置 API Token");
      return;
    }
    const formState = policyForms[service.name] ?? buildPolicyForm(service.status);
    try {
      const payload = {
        quota: {
          limitPerMinute: parseNumberInput(formState.quotaLimitPerMinute),
          burstMultiplier: parseNumberInput(formState.quotaBurstMultiplier),
        },
        circuitBreaker: {
          failureThreshold: parseNumberInput(formState.circuitFailureThreshold),
          cooldownSeconds: parseNumberInput(formState.circuitCooldownSeconds),
          minimumSamples: parseNumberInput(formState.circuitMinimumSamples),
        },
      };

      setPolicySaving(service.name);
      setPolicyErrors((prev) => ({ ...prev, [service.name]: null }));

      const response = await fetch(
        getMcpEndpoint(`/registry/${encodeURIComponent(service.name)}/policies`),
        {
          method: "PATCH",
          headers: authorizedHeaders,
          body: JSON.stringify(payload),
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        status?: McpServiceStatus;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "更新策略失败");
      }
      if (data.status) {
        setServices((prev) =>
          prev.map((item) => (item.name === service.name ? { ...item, status: data.status } : item)),
        );
        setPolicyForms((prev) => ({
          ...prev,
          [service.name]: buildPolicyForm(data.status),
        }));
      }
    } catch (err) {
      setPolicyErrors((prev) => ({
        ...prev,
        [service.name]: err instanceof Error ? err.message : "更新策略失败",
      }));
    } finally {
      setPolicySaving(null);
    }
  };

  const triggerHealthCheck = async (service: ServiceRecord) => {
    if (!apiToken) {
      setError("请先配置 API Token");
      return;
    }
    setCheckingService(service.name);
    setHealthErrors((prev) => ({ ...prev, [service.name]: null }));
    try {
      const response = await fetch(
        getMcpEndpoint(`/registry/${encodeURIComponent(service.name)}/health-check`),
        {
          method: "POST",
          headers: authorizedHeaders,
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        status?: McpServiceStatus;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "健康检查失败");
      }
      if (data.status) {
        setServices((prev) =>
          prev.map((item) => (item.name === service.name ? { ...item, status: data.status } : item)),
        );
        setPolicyForms((prev) => ({
          ...prev,
          [service.name]: buildPolicyForm(data.status),
        }));
      }
    } catch (err) {
      setHealthErrors((prev) => ({
        ...prev,
        [service.name]: err instanceof Error ? err.message : "健康检查失败",
      }));
    } finally {
      setCheckingService(null);
    }
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
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">{service.name}</CardTitle>
                      <p className="text-sm text-muted-foreground break-all">{service.baseUrl}</p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => triggerHealthCheck(service)}
                        disabled={checkingService === service.name}
                      >
                        {checkingService === service.name ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          "健康检查"
                        )}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => togglePolicySection(service)}>
                        {expandedService === service.name ? "收起策略" : "策略配置"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEditForm(service)}>
                        编辑
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => deleteService(service.name)}>
                        删除
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
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

              {service.status ? (
                <div className="space-y-2 rounded-md border border-muted-foreground/20 bg-muted/20 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">健康状态</span>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${healthClass[service.status.health]}`}
                    >
                      {healthText[service.status.health]}
                    </span>
                  </div>
                  {service.status.message && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      {service.status.message}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>近 50 次错误率：{formatPercent(service.status.metrics.errorRate)}</div>
                    <div>连续失败：{service.status.metrics.consecutiveFailures}</div>
                    <div>P50 耗时：{formatLatency(service.status.metrics.p50Latency)}</div>
                    <div>P95 耗时：{formatLatency(service.status.metrics.p95Latency)}</div>
                    <div>最近成功：{formatTime(service.status.lastSuccessAt)}</div>
                    <div>最近错误：{formatTime(service.status.lastErrorAt)}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {service.status.quota.limitPerMinute
                      ? `配额：${service.status.quota.currentUsage}/${service.status.quota.limitPerMinute} 次/分钟 · 突发 ${service.status.quota.burstMultiplier}x`
                      : `配额：未设置限额（当前 ${service.status.quota.currentUsage} 次/分钟）`}
                  </div>
                  {service.status.lastManualCheck && (
                    <div className="text-xs text-muted-foreground">
                      最近巡检：{formatTime(service.status.lastManualCheck.checkedAt)} ·
                      {` ${healthText[service.status.lastManualCheck.status]}`}
                      {service.status.lastManualCheck.latencyMs != null
                        ? ` · ${Math.round(service.status.lastManualCheck.latencyMs)} ms`
                        : ""}
                      {service.status.lastManualCheck.message
                        ? ` · ${service.status.lastManualCheck.message}`
                        : ""}
                    </div>
                  )}
                  {service.status.circuit.open && (
                    <div className="text-xs text-destructive">
                      熔断中，预计恢复：{formatTime(service.status.circuit.releaseAt)}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-muted-foreground/30 p-3 text-xs text-muted-foreground">
                  暂无监控数据
                </div>
              )}

              {healthErrors[service.name] && (
                <p className="text-xs text-destructive">{healthErrors[service.name]}</p>
              )}

              {expandedService === service.name && (
                <div className="space-y-3 border-t border-dashed pt-3">
                  <h4 className="text-sm font-semibold">速率配额与熔断策略</h4>
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">每分钟最大调用数</label>
                      <Input
                        value={policyForms[service.name]?.quotaLimitPerMinute ?? ""}
                        placeholder="留空表示不限"
                        onChange={(event) =>
                          updatePolicyField(service.name, "quotaLimitPerMinute", event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">突发倍率</label>
                      <Input
                        value={policyForms[service.name]?.quotaBurstMultiplier ?? ""}
                        placeholder="默认 1.2"
                        onChange={(event) =>
                          updatePolicyField(service.name, "quotaBurstMultiplier", event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">熔断阈值（连续失败次数）</label>
                      <Input
                        value={policyForms[service.name]?.circuitFailureThreshold ?? ""}
                        placeholder="默认 3"
                        onChange={(event) =>
                          updatePolicyField(service.name, "circuitFailureThreshold", event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">冷却时间（秒）</label>
                      <Input
                        value={policyForms[service.name]?.circuitCooldownSeconds ?? ""}
                        placeholder="默认 60"
                        onChange={(event) =>
                          updatePolicyField(service.name, "circuitCooldownSeconds", event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-muted-foreground">最少采样次数</label>
                      <Input
                        value={policyForms[service.name]?.circuitMinimumSamples ?? ""}
                        placeholder="默认 5"
                        onChange={(event) =>
                          updatePolicyField(service.name, "circuitMinimumSamples", event.target.value)
                        }
                      />
                    </div>
                  </div>
                  {policyErrors[service.name] && (
                    <p className="text-xs text-destructive">{policyErrors[service.name]}</p>
                  )}
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => savePolicy(service)}
                      disabled={policySaving === service.name}
                    >
                      {policySaving === service.name ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        "保存策略"
                      )}
                    </Button>
                  </div>
                </div>
              )}
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
