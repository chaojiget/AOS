declare module "supertest" {
  interface Response {
    status: number;
    body: any;
    headers: Record<string, string>;
  }

  interface Test extends Promise<Response> {
    send(body: any): Test;
    set(field: string, value: string): Test;
    expect(status: number): Test;
    expect(status: number, body: any): Test;
    body: any;
    status: number;
  }

  interface SuperTest {
    get(path: string): Test;
    post(path: string): Test;
    put(path: string): Test;
    delete(path: string): Test;
  }

  function request(app: any): SuperTest;

  export = request;
}
