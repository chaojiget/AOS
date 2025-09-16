import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import ts from "typescript";

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2021,
  esModuleInterop: true,
};

export async function importTsModule(relativePath, baseUrl) {
  const sourceUrl = new URL(relativePath, baseUrl);
  const source = await readFile(sourceUrl, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: COMPILER_OPTIONS,
    fileName: sourceUrl.pathname,
  });
  const encoded = Buffer.from(outputText, "utf8").toString("base64");
  const dataUrl = `data:text/javascript;base64,${encoded}`;
  return import(dataUrl);
}
