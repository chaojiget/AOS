declare module "express" {
  import type { IncomingMessage, ServerResponse } from "http";

  export interface Request<P = any, ResBody = any, ReqBody = any, ReqQuery = any>
    extends IncomingMessage {
    params: P;
    body: ReqBody;
    query: ReqQuery;
    headers: Record<string, string | string[] | undefined>;
  }

  export interface Response<ResBody = any> extends ServerResponse {
    status(code: number): this;
    json(body: ResBody): this;
  }
}
