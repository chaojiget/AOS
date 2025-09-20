import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";

import budgetHandler from "../../pages/api/guardian/budget";
import approvalsHandler from "../../pages/api/guardian/approvals";
import alertsStreamHandler, {
  config as alertsStreamConfig,
} from "../../pages/api/guardian/alerts/stream";
import { getGuardianStateSnapshot, resetGuardianState } from "../../pages/api/guardian/state";

interface MockJsonRes {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
  status: (code: number) => MockJsonRes;
  setHeader: (key: string, value: string) => void;
  json: (payload: any) => MockJsonRes;
}

function createJsonRes(): MockJsonRes {
  const res: MockJsonRes = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function createSseRes() {
  let ended = false;
  const chunks: string[] = [];
  const res = new EventEmitter() as unknown as NextApiResponse;
  (res as any).statusCode = 200;
  (res as any).headers = {};
  (res as any).setHeader = (key: string, value: string) => {
    (res as any).headers[key] = value;
  };
  (res as any).writeHead = (code: number) => {
    (res as any).statusCode = code;
    return res;
  };
  (res as any).write = (chunk: string | Buffer) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  };
  (res as any).flushHeaders = () => {};
  (res as any).end = () => {
    ended = true;
  };
  return { res, chunks, hasEnded: () => ended };
}

function nextRequest(method: string, body?: any): NextApiRequest {
  const req = new EventEmitter() as unknown as NextApiRequest;
  (req as any).method = method;
  (req as any).headers = {};
  if (body !== undefined) {
    (req as any).body = body;
  }
  return req;
}

describe("Guardian API routes", () => {
  beforeEach(() => {
    resetGuardianState();
  });

  afterEach(() => {
    resetGuardianState();
  });

  it("returns the current guardian budget", () => {
    const req = nextRequest("GET");
    const res = createJsonRes();

    budgetHandler(req, res as unknown as NextApiResponse);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBeTruthy();
    expect(typeof res.body.currency).toBe("string");
    expect(typeof res.body.limit).toBe("number");
    expect(typeof res.body.used).toBe("number");
    expect(typeof res.body.remaining).toBe("number");
    expect(["ok", "warning", "critical"]).toContain(res.body.status);
  });

  it("updates guardian alerts via approvals endpoint", async () => {
    const snapshot = getGuardianStateSnapshot();
    const pendingAlert = snapshot.alerts.find((alert) => alert.status === "open");
    expect(pendingAlert).toBeTruthy();
    const alertId = pendingAlert!.id;

    const req = nextRequest("POST", { alert_id: alertId, decision: "approve", note: "预算已审阅" });
    const res = createJsonRes();

    await approvalsHandler(req, res as unknown as NextApiResponse);

    expect(res.statusCode).toBe(200);
    expect(res.body?.status).toBe("approved");
    expect(res.body?.alert?.status).toBe("approved");
    expect(res.body?.alert?.id).toBe(alertId);
  });

  it("streams guardian events to SSE clients", async () => {
    expect(alertsStreamConfig.api?.bodyParser).toBe(false);
    const req = nextRequest("GET");
    const { res, chunks, hasEnded } = createSseRes();

    alertsStreamHandler(req, res as unknown as NextApiResponse);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const payload = chunks.join("");
    expect(payload).toContain("budget.updated");
    expect(payload).toContain("alert");

    req.emit("close");
    expect(hasEnded()).toBe(true);
  });
});
