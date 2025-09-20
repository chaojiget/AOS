import type { NextApiRequest, NextApiResponse } from "next";

import {
  buildAuthHeaders,
  resolveApiBaseUrl,
  submitLocalApproval,
  submitRemoteApproval,
  type RunApprovalRequest,
} from "../../run";

function normaliseDecision(value: unknown): "approve" | "reject" | null {
  if (value === "approve" || value === "reject") {
    return value;
  }
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "approve" || lower === "approved") {
      return "approve";
    }
    if (lower === "reject" || lower === "denied" || lower === "deny") {
      return "reject";
    }
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const { runId } = req.query;

  if (typeof runId !== "string" || !runId) {
    res.status(400).json({ error: { message: "runId is required" } });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: { message: "Method Not Allowed" } });
    return;
  }

  const requestId =
    typeof req.body?.requestId === "string"
      ? req.body.requestId
      : typeof req.body?.request_id === "string"
        ? req.body.request_id
        : typeof req.body?.id === "string"
          ? req.body.id
          : null;
  const decision = normaliseDecision(req.body?.decision);

  if (!requestId) {
    res.status(400).json({ error: { message: "requestId is required" } });
    return;
  }

  if (!decision) {
    res.status(400).json({ error: { message: "decision must be approve or reject" } });
    return;
  }

  const payload: RunApprovalRequest = { requestId, decision };
  const apiBase = resolveApiBaseUrl();
  const headers = buildAuthHeaders();

  try {
    if (apiBase) {
      const { status, body } = await submitRemoteApproval(apiBase, runId, payload, headers);
      if (status >= 200 && status < 300) {
        res.status(status).json(body ?? { decision });
        return;
      }
      res.status(status).json(
        body ?? { error: { message: `approval request failed with status ${status}` } },
      );
      return;
    }

    const result = await submitLocalApproval(runId, payload);
    res.status(200).json(result);
  } catch (error: any) {
    const message = error?.message ?? "failed to submit approval";
    res.status(500).json({ error: { message } });
  }
}
