#!/usr/bin/env node
import { spawn } from "node:child_process";

const processes = [
  { label: "web", command: ["pnpm", "run", "dev"] },
  { label: "api", command: ["pnpm", "run", "dev:api"] },
];

const children = new Map();
let shuttingDown = false;

const terminateOthers = (currentLabel) => {
  for (const [label, child] of children) {
    if (label === currentLabel) continue;
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGINT");
    }
  }
};

const handleExit = (label, code, signal) => {
  if (!shuttingDown) {
    shuttingDown = true;
    terminateOthers(label);
    if (signal) {
      process.exitCode = 1;
    } else {
      process.exitCode = code ?? 0;
    }
  }
};

const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  terminateOthers(undefined);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

for (const { label, command } of processes) {
  const child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.set(label, child);
  child.on("exit", (code, signal) => handleExit(label, code, signal));
}
