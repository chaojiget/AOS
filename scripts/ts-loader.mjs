import { access, readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const TS_EXTENSIONS = [".ts", ".tsx"];
const COMPILER_OPTIONS = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  esModuleInterop: true,
  skipLibCheck: true,
  sourceMap: false,
  jsx: ts.JsxEmit.ReactJSX,
};

async function fileExists(url) {
  try {
    await access(fileURLToPath(url));
    return true;
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith("node:") || specifier.startsWith("data:")) {
    return defaultResolve(specifier, context, defaultResolve);
  }

  const attemptDefault = await defaultResolve(specifier, context, defaultResolve).catch((error) => {
    if (error.code !== "ERR_MODULE_NOT_FOUND") {
      throw error;
    }
    return null;
  });
  if (attemptDefault) {
    const extension = extname(attemptDefault.url);
    if (TS_EXTENSIONS.includes(extension)) {
      return { url: attemptDefault.url, shortCircuit: true };
    }
    return attemptDefault;
  }

  const parentURL = context.parentURL ?? pathToFileURL(process.cwd() + "/").href;
  for (const ext of TS_EXTENSIONS) {
    const candidate = new URL(
      specifier.endsWith(ext) ? specifier : `${specifier}${ext}`,
      parentURL,
    );
    if (await fileExists(candidate)) {
      return { url: candidate.href, shortCircuit: true };
    }
  }

  throw new Error(`Unable to resolve ${specifier}`);
}

export async function load(url, context, defaultLoad) {
  if (TS_EXTENSIONS.some((ext) => url.endsWith(ext))) {
    const source = await readFile(fileURLToPath(url), "utf8");
    const transpiled = ts.transpileModule(source, {
      compilerOptions: COMPILER_OPTIONS,
      fileName: fileURLToPath(url),
    });
    return { format: "module", source: transpiled.outputText, shortCircuit: true };
  }
  return defaultLoad(url, context, defaultLoad);
}
