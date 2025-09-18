declare module "vitest" {
  type TestFn = () => void | Promise<void>;

  export function describe(name: string, fn: TestFn): void;
  export function it(name: string, fn: TestFn, timeout?: number): void;
  export const test: typeof it;
  export function beforeEach(fn: TestFn): void;
  export function afterEach(fn: TestFn): void;
  export function afterAll(fn: TestFn): void;
  export function expect<T>(value: T): any;
  export const vi: any;
}
