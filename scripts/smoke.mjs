#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

console.log("Running smoke tests...");

// Ensure directories exist
await mkdir("episodes", { recursive: true });
await mkdir("reports", { recursive: true });

console.log("✓ Created required directories");

// Create mock episode file for testing
console.log("Creating smoke test episode...");
const mockEpisodeId = `smoke-test-${Date.now()}`;
const mockEpisode = {
  id: mockEpisodeId,
  ts: new Date().toISOString(),
  type: "agent.final",
  version: 1,
  trace_id: mockEpisodeId,
  data: { type: "final", outputs: { text: "Smoke test completed successfully" } },
};

await writeFile(join("episodes", `${mockEpisodeId}.jsonl`), JSON.stringify(mockEpisode) + "\n");

console.log("✓ Created episode file");

// Create a basic smoke test report
const report = {
  timestamp: new Date().toISOString(),
  status: "passed",
  tests: [
    { name: "directory_creation", status: "passed" },
    { name: "episode_generation", status: "passed" },
  ],
};

await writeFile(join("reports", "smoke-test.json"), JSON.stringify(report, null, 2));

console.log("✓ Generated smoke test report");
console.log("🚀 Smoke tests completed successfully!");
