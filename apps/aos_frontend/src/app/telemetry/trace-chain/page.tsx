'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { fetchTraces, fetchTraceLogs, TraceListItem, LogEntry } from '@/lib/api';

export default function TraceChainPage() {
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('id');

  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [selectedLogs, setSelectedLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTraces(50)
      .then(setTraces)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedLogs([]);
      return;
    }
    fetchTraceLogs(selectedId).then(setSelectedLogs).catch(console.error);
  }, [selectedId]);

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto">
        <header className="flex items-center gap-4 mb-6">
          <Link href="/" className="text-aos-muted hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold">Trace Chain</h1>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Trace List */}
          <div className="lg:col-span-1">
            <h2 className="text-sm font-semibold text-aos-muted mb-3">Traces</h2>
            {loading ? (
              <div className="text-aos-muted text-sm">加载中...</div>
            ) : traces.length === 0 ? (
              <div className="text-aos-muted text-sm">暂无 Trace 数据</div>
            ) : (
              <div className="space-y-2 max-h-[70vh] overflow-y-auto">
                {traces.map((trace) => (
                  <Link
                    key={trace.trace_id}
                    href={`/telemetry/trace-chain?id=${trace.trace_id}`}
                    className={`block p-3 rounded-lg border transition-colors ${
                      selectedId === trace.trace_id
                        ? 'bg-aos-accent/20 border-aos-accent'
                        : 'bg-aos-card border-aos-border hover:border-aos-accent/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs text-aos-accent">
                        {trace.trace_id.slice(0, 12)}...
                      </span>
                      <ChevronRight className="w-4 h-4 text-aos-muted" />
                    </div>
                    <div className="text-xs text-aos-muted">
                      {trace.event_count} 事件 ·{' '}
                      {formatDistanceToNow(new Date(trace.last_seen), {
                        addSuffix: true,
                        locale: zhCN,
                      })}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {trace.event_types.slice(0, 3).map((type) => (
                        <span
                          key={type}
                          className="px-1.5 py-0.5 bg-aos-border rounded text-[10px] text-aos-muted"
                        >
                          {type.split('.').pop()}
                        </span>
                      ))}
                      {trace.event_types.length > 3 && (
                        <span className="text-[10px] text-aos-muted">
                          +{trace.event_types.length - 3}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Trace Detail */}
          <div className="lg:col-span-2">
            <h2 className="text-sm font-semibold text-aos-muted mb-3">
              {selectedId ? `Trace: ${selectedId.slice(0, 16)}...` : '选择一个 Trace 查看详情'}
            </h2>
            {selectedId && selectedLogs.length > 0 ? (
              <div className="space-y-2 max-h-[70vh] overflow-y-auto">
                {selectedLogs.map((log, idx) => (
                  <div
                    key={log.id}
                    className="p-3 bg-aos-card border border-aos-border rounded-lg"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-6 h-6 flex items-center justify-center bg-aos-border rounded-full text-xs">
                        {idx + 1}
                      </span>
                      <span className="font-mono text-sm text-aos-accent">
                        {log.event_type}
                      </span>
                      <span className="text-xs text-aos-muted ml-auto">
                        {log.timestamp
                          ? new Date(log.timestamp).toLocaleTimeString('zh-CN')
                          : ''}
                      </span>
                    </div>
                    {log.attributes && (
                      <pre className="text-xs text-aos-muted overflow-x-auto max-h-40 overflow-y-auto bg-aos-bg p-2 rounded">
                        {JSON.stringify(log.attributes, null, 2).slice(0, 800)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            ) : selectedId ? (
              <div className="text-aos-muted text-sm">加载中...</div>
            ) : (
              <div className="text-aos-muted text-sm p-8 text-center border border-dashed border-aos-border rounded-lg">
                从左侧列表选择一个 Trace
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
