declare module "better-sqlite3" {
  namespace BetterSqlite3 {
    interface Options {
      readonly?: boolean;
      fileMustExist?: boolean;
    }

    interface RunResult {
      changes: number;
      lastInsertRowid: number | bigint;
    }

    interface Statement<T = any> {
      get(...params: any[]): T;
      run(...params: any[]): RunResult;
      all(...params: any[]): T[];
    }

    type Database = BetterSqlite3;
  }

  class BetterSqlite3 {
    constructor(filename: string, options?: BetterSqlite3.Options);
    pragma(query: string): void;
    exec(sql: string): void;
    prepare<T = any>(sql: string): BetterSqlite3.Statement<T>;
    close(): void;
  }

  export = BetterSqlite3;
}
