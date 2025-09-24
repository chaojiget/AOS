declare module 'better-sqlite3' {
  type Params = Record<string, unknown> | unknown[];

  export interface Statement {
    run(params?: Params): { changes: number; lastInsertRowid: unknown };
  }

  export interface Database {
    exec(sql: string): Database;
    prepare(sql: string): Statement;
    transaction<T extends (...args: any[]) => unknown>(fn: T): T;
    close(): void;
  }

  interface DatabaseConstructor {
    new (path: string, options?: Record<string, unknown>): Database;
  }

  const DatabaseCtor: DatabaseConstructor;

  export default DatabaseCtor;
}

