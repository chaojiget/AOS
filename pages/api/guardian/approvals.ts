import type { NextApiRequest, NextApiResponse } from "next";

import { updateGuardianAlert, type Decision } from "./state";

interface ApprovalPayload {
  alert_id?: string;
  alertId?: string;
  decision?: string;
  note?: string;
}

const allowedDecisions = new Set(["approve", "reject", "resolve"]);

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: { message: "Method Not Allowed" } });
    return;
  }

  const payload = (req.body ?? {}) as ApprovalPayload;
  const alertId =
    typeof payload.alert_id === "string" && payload.alert_id.length > 0
      ? payload.alert_id
      : typeof payload.alertId === "string" && payload.alertId.length > 0
        ? payload.alertId
        : "";
  const decision = typeof payload.decision === "string" ? payload.decision.toLowerCase() : "";
  if (!alertId || !allowedDecisions.has(decision)) {
    res.status(400).json({ error: { message: "Invalid guardian approval payload" } });
    return;
  }

  const decisionValue = decision as Decision;
  const result = updateGuardianAlert(alertId, decisionValue, payload.note);
  if (!result) {
    res.status(404).json({ error: { message: `guardian alert ${alertId} not found` } });
    return;
  }

  res.status(200).json({
    status: result.status,
    alert: {
      id: result.alert.id,
      message: result.alert.message,
      severity: result.alert.severity,
      status: result.alert.status,
      require_approval: result.alert.requireApproval,
      created_at: result.alert.createdAt,
      updated_at: result.alert.updatedAt,
      trace_id: result.alert.traceId,
      replay_url: result.alert.replayUrl,
      details_url: result.alert.detailsUrl,
    },
    ...(result.message ? { message: result.message } : {}),
  });
}
