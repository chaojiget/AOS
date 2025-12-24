import Link from 'next/link';
import { Activity, Database, Cpu } from 'lucide-react';

export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-12">
          <h1 className="text-3xl font-bold mb-2">AOS</h1>
          <p className="text-aos-muted">Agent Operating System - Inverse Entropy Edition</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/telemetry/neural-stream"
            className="block p-6 bg-aos-card border border-aos-border rounded-lg hover:border-aos-accent transition-colors"
          >
            <Activity className="w-8 h-8 mb-4 text-aos-accent" />
            <h2 className="text-xl font-semibold mb-2">Neural Stream</h2>
            <p className="text-aos-muted text-sm">
              实时日志流，观察 Agent 的思维活动
            </p>
          </Link>

          <Link
            href="/telemetry/trace-chain"
            className="block p-6 bg-aos-card border border-aos-border rounded-lg hover:border-aos-accent transition-colors"
          >
            <Database className="w-8 h-8 mb-4 text-aos-accent" />
            <h2 className="text-xl font-semibold mb-2">Trace Chain</h2>
            <p className="text-aos-muted text-sm">
              按 Trace ID 浏览会话日志与 Span 树
            </p>
          </Link>

          <Link
            href="/telemetry/memory-vault"
            className="block p-6 bg-aos-card border border-aos-border rounded-lg hover:border-aos-accent transition-colors"
          >
            <Cpu className="w-8 h-8 mb-4 text-aos-accent" />
            <h2 className="text-xl font-semibold mb-2">Memory Vault</h2>
            <p className="text-aos-muted text-sm">
              长期记忆卡片（WisdomItem）浏览
            </p>
          </Link>
        </div>
      </div>
    </main>
  );
}
