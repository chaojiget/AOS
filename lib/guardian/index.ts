const API_BASE = process.env.NEXT_PUBLIC_AOS_API_BASE ?? "";

function resolveUrl(path: string): string {
  if (path.startsWith("http")) {
    return path;
  }
  return `${API_BASE}${path}`;
}

async function parseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const candidate =
      payload && typeof payload === "object" && "message" in payload
        ? (payload as Record<string, unknown>).message
        : undefined;
    const message =
      typeof candidate === "string" ? candidate : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return (payload ?? {}) as T;
}

export type GuardianBudgetStatus = "ok" | "warning" | "critical";

export interface GuardianBudget {
  currency: string;
  limit: number;
  used: number;
  remaining: number;
  status: GuardianBudgetStatus;
  updatedAt?: string;
}

export type GuardianAlertSeverity = "info" | "warning" | "critical";
export type GuardianAlertStatus = "open" | "approved" | "rejected" | "resolved";

export interface GuardianAlert {
  id: string;
  createdAt: string;
  updatedAt?: string;
  message: string;
  severity: GuardianAlertSeverity;
  status: GuardianAlertStatus;
  requireApproval: boolean;
  traceId?: string;
  replayUrl?: string;
  detailsUrl?: string;
}

export interface GuardianAlertEvent {
  type: "alert.created" | "alert.updated" | "alert.resolved" | "budget.updated";
  alert?: GuardianAlert;
  budget?: GuardianBudget;
}

interface GuardianBudgetDto {
  currency?: string;
  limit?: number;
  used?: number;
  remaining?: number;
  status?: string;
  updated_at?: string;
  updatedAt?: string;
}

interface GuardianAlertDto {
  id?: string;
  created_at?: string;
  updated_at?: string;
  createdAt?: string;
  updatedAt?: string;
  message?: string;
  severity?: string;
  status?: string;
  require_approval?: boolean;
  requireApproval?: boolean;
  trace_id?: string;
  traceId?: string;
  replay_url?: string;
  replayUrl?: string;
  details_url?: string;
  detailsUrl?: string;
}

interface GuardianAlertEventDto {
  type?: string;
  alert?: GuardianAlertDto | null;
  budget?: GuardianBudgetDto | null;
}

function ensureNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function normaliseBudget(raw: unknown): GuardianBudget | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const dto = raw as GuardianBudgetDto;
  const limit = ensureNumber(dto.limit, ensureNumber((raw as any).budget_limit));
  const used = ensureNumber(dto.used, ensureNumber((raw as any).budget_used));
  const remainingValue =
    "remaining" in dto && dto.remaining != null ? ensureNumber(dto.remaining) : limit - used;
  const statusCandidate = (dto.status ?? (raw as any).budget_status) as string | undefined;
  const status: GuardianBudgetStatus =
    statusCandidate === "warning" || statusCandidate === "critical" ? statusCandidate : "ok";
  const currency =
    typeof dto.currency === "string" && dto.currency.trim().length > 0 ? dto.currency : "USD";
  const updatedAt =
    typeof dto.updatedAt === "string" && dto.updatedAt.length > 0
      ? dto.updatedAt
      : typeof dto.updated_at === "string" && dto.updated_at.length > 0
        ? dto.updated_at
        : undefined;
  return {
    currency,
    limit,
    used,
    remaining: Math.max(0, remainingValue),
    status,
    ...(updatedAt ? { updatedAt } : {}),
  } satisfies GuardianBudget;
}

function normaliseAlert(raw: unknown): GuardianAlert | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const dto = raw as GuardianAlertDto;
  if (typeof dto.id !== "string" || dto.id.length === 0) {
    return null;
  }
  const createdAt =
    typeof dto.createdAt === "string" && dto.createdAt.length > 0
      ? dto.createdAt
      : typeof dto.created_at === "string" && dto.created_at.length > 0
        ? dto.created_at
        : new Date().toISOString();
  const updatedAt =
    typeof dto.updatedAt === "string" && dto.updatedAt.length > 0
      ? dto.updatedAt
      : typeof dto.updated_at === "string" && dto.updated_at.length > 0
        ? dto.updated_at
        : undefined;
  const severityCandidate = dto.severity?.toLowerCase();
  const severity: GuardianAlertSeverity =
    severityCandidate === "warning" || severityCandidate === "critical"
      ? severityCandidate
      : "info";
  const statusCandidate = dto.status?.toLowerCase();
  const status: GuardianAlertStatus =
    statusCandidate === "approved" ||
    statusCandidate === "rejected" ||
    statusCandidate === "resolved"
      ? statusCandidate
      : "open";
  const requireApproval = Boolean(dto.requireApproval ?? dto.require_approval);
  const traceId =
    typeof dto.traceId === "string" && dto.traceId.length > 0
      ? dto.traceId
      : typeof dto.trace_id === "string" && dto.trace_id.length > 0
        ? dto.trace_id
        : undefined;
  const replayUrl =
    typeof dto.replayUrl === "string" && dto.replayUrl.length > 0
      ? dto.replayUrl
      : typeof dto.replay_url === "string" && dto.replay_url.length > 0
        ? dto.replay_url
        : undefined;
  const detailsUrl =
    typeof dto.detailsUrl === "string" && dto.detailsUrl.length > 0
      ? dto.detailsUrl
      : typeof dto.details_url === "string" && dto.details_url.length > 0
        ? dto.details_url
        : undefined;
  const message =
    typeof dto.message === "string" && dto.message.length > 0 ? dto.message : "Guardian alert";
  return {
    id: dto.id,
    createdAt,
    ...(updatedAt ? { updatedAt } : {}),
    message,
    severity,
    status,
    requireApproval,
    ...(traceId ? { traceId } : {}),
    ...(replayUrl ? { replayUrl } : {}),
    ...(detailsUrl ? { detailsUrl } : {}),
  } satisfies GuardianAlert;
}

function parseAlertEvent(raw: unknown): GuardianAlertEvent | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const dto = raw as GuardianAlertEventDto;
  const typeCandidate = typeof dto.type === "string" ? dto.type : "";
  const normalisedType = ((): GuardianAlertEvent["type"] | null => {
    if (typeCandidate === "alert.created" || typeCandidate === "alert.updated") {
      return typeCandidate;
    }
    if (typeCandidate === "alert.resolved" || typeCandidate === "resolved") {
      return "alert.resolved";
    }
    if (typeCandidate === "budget.updated" || typeCandidate === "budget") {
      return "budget.updated";
    }
    return null;
  })();
  if (!normalisedType) {
    return null;
  }
  const alert = dto.alert ? normaliseAlert(dto.alert) : undefined;
  const budget = dto.budget ? normaliseBudget(dto.budget) : undefined;
  return {
    type: normalisedType,
    ...(alert ? { alert } : {}),
    ...(budget ? { budget } : {}),
  } satisfies GuardianAlertEvent;
}

export async function fetchGuardianBudget(): Promise<GuardianBudget> {
  const response = await fetch(resolveUrl("/api/guardian/budget"), {
    headers: { Accept: "application/json" },
  });
  const payload = await parseJson<GuardianBudgetDto>(response);
  const budget = normaliseBudget(payload);
  if (!budget) {
    throw new Error("Invalid guardian budget payload");
  }
  return budget;
}

export interface GuardianAlertSubscriptionOptions {
  onEvent: (event: GuardianAlertEvent) => void;
  onError?: (error: Error) => void;
}

export function subscribeGuardianAlerts(options: GuardianAlertSubscriptionOptions): () => void {
  if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
    return () => {};
  }
  const url = resolveUrl("/api/guardian/alerts/stream");
  let closed = false;
  let source: EventSource | null = null;
  const handleError = (error: Error) => {
    if (options.onError) {
      options.onError(error);
    }
  };
  try {
    source = new window.EventSource(url);
  } catch (error) {
    handleError(error instanceof Error ? error : new Error("Failed to connect to guardian alerts"));
    return () => {};
  }
  const handleMessage = (event: MessageEvent<string>) => {
    if (!event.data) {
      return;
    }
    try {
      const parsed = JSON.parse(event.data) as GuardianAlertEventDto;
      const normalised = parseAlertEvent(parsed);
      if (normalised) {
        options.onEvent(normalised);
      }
    } catch (error) {
      handleError(error instanceof Error ? error : new Error("Failed to parse guardian event"));
    }
  };
  source.onmessage = handleMessage;
  source.onerror = () => {
    handleError(new Error("Guardian alert stream disconnected"));
    if (source) {
      source.close();
    }
  };
  return () => {
    if (!closed) {
      closed = true;
      if (source) {
        source.close();
      }
    }
  };
}

export interface GuardianApprovalRequest {
  alertId: string;
  decision: "approve" | "reject";
  note?: string;
}

export interface GuardianApprovalResponse {
  status: GuardianAlertStatus;
  alert: GuardianAlert | null;
  message?: string;
}

export async function submitGuardianApproval(
  input: GuardianApprovalRequest,
): Promise<GuardianApprovalResponse> {
  const response = await fetch(resolveUrl("/api/guardian/approvals"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      alert_id: input.alertId,
      alertId: input.alertId,
      decision: input.decision,
      note: input.note,
    }),
  });
  const payload = await parseJson<{
    status?: string;
    alert?: GuardianAlertDto | null;
    message?: string;
  }>(response);
  const alert = payload.alert ? normaliseAlert(payload.alert) : null;
  const statusCandidate = payload.status?.toLowerCase();
  const status: GuardianAlertStatus =
    statusCandidate === "approved" ||
    statusCandidate === "rejected" ||
    statusCandidate === "resolved"
      ? statusCandidate
      : (alert?.status ?? (input.decision === "approve" ? "approved" : "rejected"));
  return {
    status,
    alert,
    ...(payload.message && typeof payload.message === "string" ? { message: payload.message } : {}),
  } satisfies GuardianApprovalResponse;
}
