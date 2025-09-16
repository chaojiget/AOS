const STATE = {
  root: null,
  stack: [],
};

function createSuite(name, parent = null) {
  return {
    name,
    parent,
    suites: [],
    tests: [],
    beforeEach: [],
    afterEach: [],
  };
}

function ensureRoot() {
  if (!STATE.root) {
    STATE.root = createSuite("root");
    STATE.stack = [STATE.root];
  }
  return STATE.root;
}

export function resetSuites() {
  STATE.root = createSuite("root");
  STATE.stack = [STATE.root];
}

function currentSuite() {
  ensureRoot();
  return STATE.stack[STATE.stack.length - 1];
}

export function describe(name, handler) {
  if (typeof name !== "string") {
    throw new TypeError("describe name must be a string");
  }
  const parent = currentSuite();
  const suite = createSuite(name, parent);
  parent.suites.push(suite);
  STATE.stack.push(suite);
  try {
    const result = handler?.();
    if (result && typeof result.then === "function") {
      throw new Error("Asynchronous describe blocks are not supported in this lightweight runner");
    }
  } finally {
    STATE.stack.pop();
  }
}

function registerTest(name, fn) {
  if (typeof name !== "string") {
    throw new TypeError("test name must be a string");
  }
  if (typeof fn !== "function") {
    throw new TypeError("test fn must be a function");
  }
  const suite = currentSuite();
  suite.tests.push({ name, fn });
}

export function it(name, fn) {
  registerTest(name, fn);
}

export const test = it;

export function beforeEach(fn) {
  if (typeof fn !== "function") {
    throw new TypeError("beforeEach hook must be a function");
  }
  currentSuite().beforeEach.push(fn);
}

export function afterEach(fn) {
  if (typeof fn !== "function") {
    throw new TypeError("afterEach hook must be a function");
  }
  currentSuite().afterEach.push(fn);
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (isObject(a) && isObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) {
        return false;
      }
      if (!deepEqual(a[key], b[key])) {
        return false;
      }
    }
    return true;
  }

  return false;
}

function format(value) {
  if (typeof value === "string") return `"${value}"`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function makeMatchers(received, negate = false) {
  const ensure = (condition, message) => {
    const pass = Boolean(condition);
    if (negate ? pass : !pass) {
      throw new Error(message);
    }
  };

  return {
    toBe(expected) {
      ensure(
        Object.is(received, expected),
        `Expected ${format(received)} ${negate ? "not " : ""}to be ${format(expected)}`,
      );
    },
    toEqual(expected) {
      ensure(
        deepEqual(received, expected),
        `Expected ${format(received)} ${negate ? "not " : ""}to equal ${format(expected)}`,
      );
    },
    toStrictEqual(expected) {
      this.toEqual(expected);
    },
    toBeTruthy() {
      ensure(
        Boolean(received),
        `Expected ${format(received)} ${negate ? "to be falsy" : "to be truthy"}`,
      );
    },
    toBeFalsy() {
      ensure(!received, `Expected ${format(received)} ${negate ? "to be truthy" : "to be falsy"}`);
    },
    toHaveLength(expected) {
      if (received == null || typeof received.length !== "number") {
        throw new Error(`Received value does not have a length: ${format(received)}`);
      }
      ensure(
        received.length === expected,
        `Expected length ${expected}, received ${received.length}`,
      );
    },
    toContainEqual(expected) {
      if (!Array.isArray(received)) {
        throw new Error(`Expected an array but received ${format(received)}`);
      }
      const found = received.some((item) => deepEqual(item, expected));
      ensure(found, `Expected array ${negate ? "not " : ""}to contain ${format(expected)}`);
    },
    toMatchObject(expected) {
      if (!isObject(received) || !isObject(expected)) {
        throw new Error("toMatchObject expects plain objects");
      }
      const keys = Object.keys(expected);
      const matches = keys.every((key) => deepEqual(received[key], expected[key]));
      ensure(
        matches,
        `Expected ${format(received)} ${negate ? "not " : ""}to match object ${format(expected)}`,
      );
    },
    toBeInstanceOf(expected) {
      if (typeof expected !== "function") {
        throw new Error("toBeInstanceOf expects a constructor");
      }
      ensure(
        received instanceof expected,
        `Expected value to ${negate ? "not " : ""}be instance of ${expected.name || "provided constructor"}`,
      );
    },
    get not() {
      return makeMatchers(received, !negate);
    },
  };
}

export function expect(received) {
  const matchers = makeMatchers(received);
  Object.defineProperty(matchers, "not", {
    get() {
      return makeMatchers(received, true);
    },
  });
  return matchers;
}

function gatherBeforeEach(chain) {
  return chain.flatMap((suite) => suite.beforeEach);
}

function gatherAfterEach(chain) {
  const hooks = [];
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    hooks.push(...chain[i].afterEach);
  }
  return hooks;
}

async function runSuite(suite, reporter, summary, chain = []) {
  const nextChain = chain.concat(suite);

  if (suite !== ensureRoot()) {
    summary.suites += 1;
    reporter?.onSuiteStart?.(suite, nextChain);
  }

  for (const child of suite.suites) {
    await runSuite(child, reporter, summary, nextChain);
  }

  for (const test of suite.tests) {
    summary.tests += 1;
    reporter?.onTestStart?.(test, nextChain);
    const beforeHooks = gatherBeforeEach(nextChain);
    const afterHooks = gatherAfterEach(nextChain);
    const started = Date.now();
    let error = null;
    try {
      for (const hook of beforeHooks) {
        await hook();
      }
      await test.fn();
      summary.passed += 1;
      reporter?.onTestSuccess?.(test, nextChain, Date.now() - started);
    } catch (err) {
      error = err;
      summary.failed += 1;
      reporter?.onTestFail?.(test, nextChain, err);
    } finally {
      for (const hook of afterHooks) {
        try {
          await hook();
        } catch (hookError) {
          error = error || hookError;
          reporter?.onHookError?.(hookError, nextChain);
        }
      }
    }
    if (error) {
      reporter?.onTestError?.(test, nextChain, error);
    }
  }

  if (suite !== ensureRoot()) {
    reporter?.onSuiteFinish?.(suite, nextChain);
  }
}

export async function runSuites(reporter) {
  ensureRoot();
  const summary = { suites: 0, tests: 0, passed: 0, failed: 0, duration: 0 };
  const started = Date.now();
  await runSuite(STATE.root, reporter, summary, []);
  summary.duration = Date.now() - started;
  return summary;
}

resetSuites();

export default {
  describe,
  it,
  test,
  beforeEach,
  afterEach,
  expect,
  runSuites,
  resetSuites,
};
