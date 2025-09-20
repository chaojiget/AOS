import Head from "next/head";
import Link from "next/link";
import type { NextPage } from "next";
import { useCallback, useState } from "react";
import { pageContainerClass, shellClass, headerSurfaceClass, headingClass, labelClass, panelSurfaceClass, primaryButtonClass, outlineButtonClass, subtleTextClass } from "../lib/theme";
import { registerMcpEndpoint, type McpRegisterPayload } from "../lib/mcp";

const ToolsPage: NextPage = () => {
  const [form, setForm] = useState<McpRegisterPayload>({ name: "mcp-core", transport: "http", baseUrl: "http://localhost:8765/rpc", enabled: true });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value } as McpRegisterPayload));
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const payload: McpRegisterPayload = { ...form };
      const res = await registerMcpEndpoint(payload);
      setMessage(`已注册：${res.config.name} (${res.config.transport})`);
    } catch (err: any) {
      setMessage(err?.message ?? "注册失败");
    } finally {
      setBusy(false);
    }
  }, [form]);

  return (
    <div className={shellClass}>
      <Head>
        <title>MCP Tools | AOS</title>
      </Head>
      <header className={`${headerSurfaceClass} sticky top-0 z-10`}>
        <div className={`${pageContainerClass} flex items-center justify-between py-6`}>
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Operations</span>
            <h1 className={headingClass + " text-2xl"}>MCP Tools</h1>
          </div>
          <nav className="flex items-center gap-3">
            <Link href="/skills" className={outlineButtonClass}>Back</Link>
            <Link href="/run" className={primaryButtonClass}>Launch Run</Link>
          </nav>
        </div>
      </header>
      <main className={`${pageContainerClass} flex flex-col gap-6`}>
        <section className={`${panelSurfaceClass} flex flex-col gap-6 p-8`}>
          <p className={subtleTextClass}>注册或更新 MCP 端点，供代理通过 MCP 调用工具。</p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-xl">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Name</span>
              <input name="name" value={form.name} onChange={handleChange} className="rounded-lg bg-slate-800/40 px-3 py-2" required />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Transport</span>
              <select name="transport" value={form.transport} onChange={handleChange} className="rounded-lg bg-slate-800/40 px-3 py-2">
                <option value="http">http</option>
                <option value="ws">ws</option>
                <option value="stdio">stdio</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Base URL / Command</span>
              <input name="baseUrl" value={form.baseUrl ?? ""} onChange={handleChange} className="rounded-lg bg-slate-800/40 px-3 py-2" placeholder="http(s)://... 或可执行路径" />
            </label>
            <div className="flex gap-3">
              <button disabled={busy} className={primaryButtonClass} type="submit">{busy ? "提交中..." : "注册/更新"}</button>
              {message ? <span className={subtleTextClass}>{message}</span> : null}
            </div>
          </form>
        </section>
      </main>
    </div>
  );
};

export default ToolsPage;
