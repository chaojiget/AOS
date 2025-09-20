export interface EpisodeListItem {
  trace_id: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  goal?: string | null;
  step_count?: number;
  score?: number | null;
}

export interface EpisodePagination {
  page: number;
  page_size: number;
  total: number;
}

export interface EpisodeListResponse {
  code: string;
  message: string;
  data: {
    items: EpisodeListItem[];
    pagination: EpisodePagination;
  };
}

export interface EpisodeEvent {
  id: string;
  ts: string;
  type: string;
  span_id?: string | null;
  parent_span_id?: string | null;
  topic?: string | null;
  level?: string | null;
  data?: any;
}

export interface EpisodeDetailResponse {
  code: string;
  message: string;
  data: EpisodeListItem & {
    events: EpisodeEvent[];
    score?: number | null;
  };
}

export interface EpisodeReplayResponse {
  code: string;
  message: string;
  data: {
    trace_id: string;
    score_before: number | null;
    score_after: number | null;
    diff: number | null;
  };
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(text || "解析服务器响应失败");
  }
}

export async function fetchEpisodes(options: { page?: number; pageSize?: number } = {}) {
  const params = new URLSearchParams();
  if (options.page) {
    params.set("page", String(options.page));
  }
  if (options.pageSize) {
    params.set("page_size", String(options.pageSize));
  }
  const url = params.size > 0 ? `/api/episodes?${params.toString()}` : `/api/episodes`;
  const response = await fetch(url);
  if (!response.ok) {
    const message = `加载 Episodes 列表失败（${response.status}）`;
    throw new Error(message);
  }
  return parseJson<EpisodeListResponse>(response);
}

export async function fetchEpisodeDetail(traceId: string) {
  const response = await fetch(`/api/episodes/${encodeURIComponent(traceId)}`);
  if (response.status === 404) {
    throw new Error(`Episode ${traceId} 不存在`);
  }
  if (!response.ok) {
    const message = `加载 Episode 详情失败（${response.status}）`;
    throw new Error(message);
  }
  return parseJson<EpisodeDetailResponse>(response);
}

export async function replayEpisode(traceId: string, payload: any = {}) {
  const response = await fetch(`/api/episodes/${encodeURIComponent(traceId)}/replay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  if (response.status === 404) {
    throw new Error(`Episode ${traceId} 不存在`);
  }
  if (!response.ok) {
    const message = `回放 Episode 失败（${response.status}）`;
    throw new Error(message);
  }
  return parseJson<EpisodeReplayResponse>(response);
}
