import { readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { runSuites, resetSuites } from "vitest";

const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?js$/i;

async function collectFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return results;
    }
    throw error;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function formatChain(chain, testName) {
  const labels = chain
    .filter((suite) => suite.name && suite.name !== "root")
    .map((suite) => suite.name);
  if (testName) labels.push(testName);
  return labels.join(" > ");
}

async function run() {
  const testsDir = resolve(process.cwd(), "tests");
  try {
    await stat(testsDir);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      console.warn("No tests directory found.");
      return;
    }
    throw error;
  }

  const files = await collectFiles(testsDir);
  if (files.length === 0) {
    console.warn("No test files discovered.");
    return;
  }

  resetSuites();
  for (const file of files) {
    const url = pathToFileURL(file).href;
    await import(url);
  }

  const reporter = {
    onTestSuccess(test, chain, duration) {
      console.log(`✔ ${formatChain(chain, test.name)} (${duration} ms)`);
    },
    onTestFail(test, chain, error) {
      console.error(`✖ ${formatChain(chain, test.name)}`);
      if (error?.stack) {
        console.error(error.stack);
      } else {
        console.error(String(error));
      }
    },
  };

  const summary = await runSuites(reporter);
  console.log(
    `\nTotal: ${summary.tests}, Passed: ${summary.passed}, Failed: ${summary.failed}, Duration: ${summary.duration} ms`,
  );
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Vitest runner failed:", error);
  process.exitCode = 1;
});
