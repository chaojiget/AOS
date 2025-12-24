'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { fetchLogs, LogEntry } from '@/lib/api';

const EVENT_COLORS: Record<string, string> = {
  'session.created': 'text-green-400',
  'session.idle': 'text-yellow-400',
  'session.error': 'text-red-400',
  'message.updated': 'text-blue-400',
  'message.part.updated': 'text-blue-300',
  'tool.execute.before': 'text-purple-400',
  'tool.execute.after': 'text-purple-300',
  'file.edited': 'text-orange-400',
  'command.executed': 'text-cyan-400',
};

export default function NeuralStreamPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadLogs = async () => {
    try {
      const data = await fetchLogs({ limit: 100 });
      setLogs(data);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
    if (!autoRefresh) return;
    const interval = setInterval(loadLogs, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-aos-muted hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-2xl font-bold">Neural Stream</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm ${
                autoRefresh
                  ? 'bg-aos-accent text-white'
                  : 'bg-aos-card border border-aos-border text-aos-muted'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} />
              {autoRefresh ? '自动刷新' : '已暂停'}
            </button>
          </div>
        </header>

        {loading ? (
          <div className="text-center text-aos-muted py-12">加载中...</div>
        ) : logs.length === 0 ? (
          <div className="text-center text-aos-muted py-12">暂无日志数据</div>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div
                key={log.id}
                className="p-4 bg-aos-card border border-aos-border rounded-lg hover:border-aos-accent/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4 mb-2">
                  <span
                    className={`font-mono text-sm ${
                      EVENT_COLORS[log.event_type || ''] || 'text-gray-400'
                    }`}
                  >
                    {log.event_type || 'unknown'}
                  </span>
                  <span className="text-xs text-aos-muted whitespace-nowrap">
                    {formatDistanceToNow(new Date(log.received_at), {
                      addSuffix: true,
                      locale: zhCN,
                    })}
                  </span>
                </div>

                {log.trace_id && (
                  <div className="text-xs text-aos-muted mb-2">
                    <span className="text-aos-accent">trace:</span>{' '}
                    <Link
                      href={`/telemetry/trace-chain?id=${log.trace_id}`}
                      className="hover:text-white"
                    >
                      {log.trace_id.slice(0, 16)}...
                    </Link>
                  </div>
                )}

                {log.attributes && (
                  <pre className="text-xs text-aos-muted overflow-x-auto max-h-32 overflow-y-auto">
                    {JSON.stringify(log.attributes, null, 2).slice(0, 500)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
