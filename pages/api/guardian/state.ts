import { randomUUID } from "node:crypto";

type GuardianBudgetStatus = "ok" | "warning" | "critical";
type GuardianAlertSeverity = "info" | "warning" | "critical";
type GuardianAlertStatus = "open" | "approved" | "rejected" | "resolved";

type GuardianBudgetState = {
  currency: string;
  limit: number;
  used: number;
  status: GuardianBudgetStatus;
  updatedAt: string;
};

type GuardianAlertState = {
  id: string;
  message: string;
  severity: GuardianAlertSeverity;
  status: GuardianAlertStatus;
  requireApproval: boolean;
  createdAt: string;
  updatedAt?: string;
  traceId?: string;
  replayUrl?: string;
  detailsUrl?: string;
};

type GuardianAlertEventDto = {
  type: "alert.created" | "alert.updated" | "alert.resolved" | "budget.updated";
  alert?: Record<string, unknown>;
  budget?: Record<string, unknown>;
};

export type Decision = "approve" | "reject" | "resolve";

type GuardianState = {
  budget: GuardianBudgetState;
  alerts: GuardianAlertState[];
};

const subscribers = new Set<(event: GuardianAlertEventDto) => void>();

const defaultState = (): GuardianState => ({
  budget: {
    currency: "USD",
    limit: 120,
    used: 36,
    status: "ok",
    updatedAt: new Date().toISOString(),
  },
  alerts: [
    {
      id: "guardian-alert-1",
      message: "本周工具预算使用率已达 30%，请关注高开销任务。",
      severity: "warning",
      status: "open",
      requireApproval: true,
      createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      traceId: randomUUID(),
    },
    {
      id: "guardian-alert-2",
      message: "昨日审批的高风险操作执行成功。",
      severity: "info",
      status: "resolved",
      requireApproval: false,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    },
  ],
});

const state: GuardianState = defaultState();

function cloneAlert(alert: GuardianAlertState): GuardianAlertState {
  return { ...alert };
}

function alertToDto(alert: GuardianAlertState): Record<string, unknown> {
  return {
    id: alert.id,
    message: alert.message,
    severity: alert.severity,
    status: alert.status,
    require_approval: alert.requireApproval,
    created_at: alert.createdAt,
    updated_at: alert.updatedAt,
    trace_id: alert.traceId,
    replay_url: alert.replayUrl,
    details_url: alert.detailsUrl,
  } satisfies Record<string, unknown>;
}

function budgetToDto(): Record<string, unknown> {
  const remaining = Math.max(0, state.budget.limit - state.budget.used);
  return {
    currency: state.budget.currency,
    limit: state.budget.limit,
    used: state.budget.used,
    remaining,
    status: state.budget.status,
    updated_at: state.budget.updatedAt,
    updatedAt: state.budget.updatedAt,
  } satisfies Record<string, unknown>;
}

function broadcast(event: GuardianAlertEventDto): void {
  for (const subscriber of subscribers) {
    subscriber(event);
  }
}

export function resetGuardianState(): void {
  const next = defaultState();
  state.budget = next.budget;
  state.alerts = next.alerts;
}

export function getGuardianBudgetDto(): Record<string, unknown> {
  return budgetToDto();
}

export function listGuardianAlerts(): GuardianAlertState[] {
  return state.alerts.map(cloneAlert);
}

export function subscribeGuardianEvents(
  listener: (event: GuardianAlertEventDto) => void,
): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function updateGuardianBudget(
  partial: Partial<GuardianBudgetState>,
): Record<string, unknown> {
  state.budget = {
    ...state.budget,
    ...partial,
    updatedAt: partial.updatedAt ?? new Date().toISOString(),
  };
  const dto = budgetToDto();
  broadcast({ type: "budget.updated", budget: dto });
  return dto;
}

function resolveDecision(decision: Decision): GuardianAlertStatus {
  switch (decision) {
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "resolve":
      return "resolved";
    default:
      return "open";
  }
}

export function updateGuardianAlert(
  alertId: string,
  decision: Decision,
  note?: string,
): { alert: GuardianAlertState; status: GuardianAlertStatus; message?: string } | null {
  const match = state.alerts.find((alert) => alert.id === alertId);
  if (!match) {
    return null;
  }
  const status = resolveDecision(decision);
  match.status = status;
  match.requireApproval = false;
  match.updatedAt = new Date().toISOString();
  const message = note && note.trim().length > 0 ? note.trim() : undefined;
  const dto = alertToDto(match);
  broadcast({ type: status === "resolved" ? "alert.resolved" : "alert.updated", alert: dto });
  return { alert: cloneAlert(match), status, ...(message ? { message } : {}) };
}

export function getGuardianStateSnapshot(): GuardianState {
  return {
    budget: { ...state.budget },
    alerts: state.alerts.map(cloneAlert),
  };
}

export type { GuardianAlertState, GuardianBudgetState, GuardianAlertStatus };
