import { randomUUID } from 'crypto';

export type ProjectRunStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export interface RunArtifact {
  id: string;
  name: string;
  type: 'log' | 'file' | 'dataset' | 'report';
  size: number;
  downloadUrl?: string;
}

export interface RunTimelineEntry {
  id: string;
  label: string;
  status: 'pending' | 'completed' | 'error' | 'running';
  description?: string;
  occurredAt?: string;
}

export interface ProjectRunRecord {
  id: string;
  projectId: string;
  title: string;
  status: ProjectRunStatus;
  owner: string;
  triggeredBy: string;
  startedAt: string;
  finishedAt?: string;
  traceId: string;
  summary: string;
  approvalRequired: boolean;
  timeline: RunTimelineEntry[];
  artifacts: RunArtifact[];
  metadata?: Record<string, unknown>;
}

export interface SopBlueprintVersion {
  id: string;
  name: string;
  version: string;
  status: 'active' | 'draft' | 'archived';
  updatedAt: string;
  description?: string;
  editor?: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description?: string;
  owner: string;
  tags: string[];
  runs: ProjectRunRecord[];
  sopVersions: SopBlueprintVersion[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
  owner: string;
  tags: string[];
  latestRun?: ProjectRunRecord;
  activeRuns: ProjectRunRecord[];
  queuedRuns: ProjectRunRecord[];
  completedRuns: ProjectRunRecord[];
  sopVersions: SopBlueprintVersion[];
}

export type ProjectRunDetail = ProjectRunRecord;

const inMemoryProjects: ProjectRecord[] = [
  {
    id: 'proj-content-review',
    name: '视频审核 SOP',
    description: '内容安全团队的视频审核流程，涵盖采样、检测与人工复核',
    owner: 'ops-team',
    tags: ['safety', 'media'],
    sopVersions: [
      {
        id: 'sop-014',
        name: '视频审核 SOP',
        version: 'v3.2',
        status: 'active',
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 10).toISOString(),
        description: '接入最新的异常检测模型，新增多模态审计步骤',
        editor: 'zhangsan',
      },
      {
        id: 'sop-013',
        name: '视频审核 SOP',
        version: 'v3.1',
        status: 'archived',
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
        editor: 'zhangsan',
      },
    ],
    runs: [],
  },
  {
    id: 'proj-dataset-clean',
    name: '数据集清洗',
    description: '针对训练数据集的周期性清洗与质检',
    owner: 'ml-platform',
    tags: ['ml', 'ops'],
    sopVersions: [
      {
        id: 'sop-020',
        name: '训练数据质检 SOP',
        version: 'v1.8',
        status: 'active',
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
        editor: 'lisi',
      },
    ],
    runs: [],
  },
];

const seedRuns = () => {
  if (inMemoryProjects[0].runs.length) {
    return;
  }

  const now = Date.now();

  const makeTimeline = (offsets: number[]): RunTimelineEntry[] => {
    return offsets.map((offset, index) => ({
      id: `step-${index + 1}`,
      label: ['排队等待', 'MCP 工具执行', '人工复核', '归档出品'][index] ?? `阶段 ${index + 1}`,
      status: 'completed',
      occurredAt: new Date(now - offset).toISOString(),
      description: ['排队进入执行队列', '调用多模态检测 MCP 服务', '质检员复核 20% 样本', '归档并产出审核报告'][index],
    }));
  };

  const completedRun: ProjectRunRecord = {
    id: 'run-20240928-001',
    projectId: 'proj-content-review',
    title: '短视频批次审核',
    status: 'success',
    owner: 'ops-team',
    triggeredBy: 'system@ops',
    startedAt: new Date(now - 1000 * 60 * 90).toISOString(),
    finishedAt: new Date(now - 1000 * 60 * 5).toISOString(),
    traceId: 'trace-content-001',
    summary: '批次共 320 条视频，发现 5 条需人工复核，最终出具审核报告',
    approvalRequired: true,
    timeline: makeTimeline([1000 * 60 * 90, 1000 * 60 * 70, 1000 * 60 * 30, 1000 * 60 * 5]),
    artifacts: [
      {
        id: 'artifact-report-001',
        name: '审核报告.pdf',
        type: 'report',
        size: 2.4 * 1024 * 1024,
        downloadUrl: '/artifacts/report-001.pdf',
      },
      {
        id: 'artifact-log-001',
        name: '执行日志.log',
        type: 'log',
        size: 1.2 * 1024 * 1024,
        downloadUrl: '/artifacts/log-001.log',
      },
    ],
    metadata: {
      approval: {
        approver: 'auditor.liu',
        status: 'approved',
        occurredAt: new Date(now - 1000 * 60 * 6).toISOString(),
      },
    },
  };

  const runningRun: ProjectRunRecord = {
    id: 'run-20240928-002',
    projectId: 'proj-content-review',
    title: '直播内容抽检',
    status: 'running',
    owner: 'ops-team',
    triggeredBy: 'ops.li',
    startedAt: new Date(now - 1000 * 60 * 15).toISOString(),
    traceId: 'trace-content-002',
    summary: '抽检直播流 50 条，等待多模态检测结果',
    approvalRequired: false,
    timeline: [
      {
        id: 'step-1',
        label: '排队等待',
        status: 'completed',
        occurredAt: new Date(now - 1000 * 60 * 15).toISOString(),
        description: '作业开始排队等待资源',
      },
      {
        id: 'step-2',
        label: 'MCP 工具执行',
        status: 'running',
        occurredAt: new Date(now - 1000 * 60 * 10).toISOString(),
        description: '调用内容检测工具',
      },
      {
        id: 'step-3',
        label: '人工复核',
        status: 'pending',
        description: '等待检测结果后触发人工抽检',
      },
    ],
    artifacts: [],
  };

  const queuedRun: ProjectRunRecord = {
    id: 'run-20240928-003',
    projectId: 'proj-content-review',
    title: '跨境内容抽查',
    status: 'queued',
    owner: 'ops-team',
    triggeredBy: 'system@ops',
    startedAt: new Date(now - 1000 * 60 * 2).toISOString(),
    traceId: 'trace-content-003',
    summary: '等待调度窗口释放 GPU 资源',
    approvalRequired: false,
    timeline: [
      {
        id: 'step-1',
        label: '排队等待',
        status: 'running',
        occurredAt: new Date(now - 1000 * 60 * 2).toISOString(),
        description: '排队中，未开始执行',
      },
    ],
    artifacts: [],
  };

  inMemoryProjects[0].runs = [runningRun, queuedRun, completedRun];
  inMemoryProjects[1].runs = [
    {
      id: 'run-20240927-101',
      projectId: 'proj-dataset-clean',
      title: '英文语料清洗',
      status: 'success',
      owner: 'ml-platform',
      triggeredBy: 'scheduler',
      startedAt: new Date(now - 1000 * 60 * 300).toISOString(),
      finishedAt: new Date(now - 1000 * 60 * 150).toISOString(),
      traceId: 'trace-dataset-001',
      summary: '完成英文语料清洗并更新差分报告',
      approvalRequired: false,
      timeline: makeTimeline([1000 * 60 * 300, 1000 * 60 * 240, 1000 * 60 * 210, 1000 * 60 * 150]),
      artifacts: [
        {
          id: 'artifact-report-201',
          name: '质检报告.json',
          type: 'report',
          size: 860 * 1024,
          downloadUrl: '/artifacts/diff-report.json',
        },
      ],
    },
  ];
};

seedRuns();

const cloneRun = (run: ProjectRunRecord): ProjectRunRecord => ({
  ...run,
  timeline: run.timeline.map((entry) => ({ ...entry })),
  artifacts: run.artifacts.map((artifact) => ({ ...artifact })),
  metadata: run.metadata ? { ...run.metadata } : undefined,
});

const sortRuns = (runs: ProjectRunRecord[]) => {
  return [...runs].sort((a, b) => {
    const aTime = new Date(a.startedAt).getTime();
    const bTime = new Date(b.startedAt).getTime();
    return bTime - aTime;
  });
};

export const listProjectSummaries = (): ProjectSummary[] => {
  return inMemoryProjects.map((project) => {
    const sorted = sortRuns(project.runs);
    const activeRuns = sorted.filter((run) => run.status === 'running').map((run) => cloneRun(run));
    const queuedRuns = sorted.filter((run) => run.status === 'queued').map((run) => cloneRun(run));
    const completedRuns = sorted
      .filter((run) => run.status === 'success' || run.status === 'failed' || run.status === 'cancelled')
      .map((run) => cloneRun(run));
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      owner: project.owner,
      tags: project.tags,
      latestRun: sorted[0] ? cloneRun(sorted[0]) : undefined,
      activeRuns,
      queuedRuns,
      completedRuns: completedRuns.slice(0, 5),
      sopVersions: project.sopVersions.map((version) => ({ ...version })),
    };
  });
};

export const getProjectDetail = (projectId: string): ProjectRecord | null => {
  const record = inMemoryProjects.find((project) => project.id === projectId);
  if (!record) {
    return null;
  }
  return {
    ...record,
    runs: sortRuns(record.runs).map((run) => cloneRun(run)),
    sopVersions: record.sopVersions.map((version) => ({ ...version })),
  };
};

export const getRunDetail = (
  projectId: string,
  runId: string,
): ProjectRunDetail | null => {
  const project = inMemoryProjects.find((item) => item.id === projectId);
  if (!project) return null;
  const run = project.runs.find((item) => item.id === runId);
  if (!run) return null;
  return cloneRun(run);
};

export interface CreateRunOptions {
  title?: string;
  triggeredBy: string;
  sourceRunId?: string;
  metadata?: Record<string, unknown>;
}

export const createProjectRun = (
  projectId: string,
  options: CreateRunOptions,
): ProjectRunRecord => {
  const project = inMemoryProjects.find((item) => item.id === projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const sourceRun = options.sourceRunId
    ? project.runs.find((run) => run.id === options.sourceRunId)
    : undefined;

  const baseTitle = options.title?.trim() || sourceRun?.title || '新建任务';

  const now = Date.now();
  const newRun: ProjectRunRecord = {
    id: `run-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 12)}-${Math.floor(
      Math.random() * 1000,
    )}`,
    projectId: project.id,
    title: baseTitle,
    status: 'queued',
    owner: project.owner,
    triggeredBy: options.triggeredBy,
    startedAt: new Date(now).toISOString(),
    traceId: `trace-${randomUUID()}`,
    summary:
      sourceRun?.summary ||
      '任务已提交至调度队列，等待资源分配。',
    approvalRequired: sourceRun?.approvalRequired ?? false,
    timeline: [
      {
        id: 'step-queue',
        label: '排队等待',
        status: 'running',
        occurredAt: new Date(now).toISOString(),
        description: '任务排队中，等待调度器分配运行环境',
      },
      ...(sourceRun
        ? sourceRun.timeline
            .filter((entry) => entry.id !== 'step-queue')
            .map((entry): RunTimelineEntry => ({
              ...entry,
              status: 'pending',
              occurredAt: undefined,
            }))
        : []),
    ],
    artifacts: [],
    metadata: options.metadata,
  };

  project.runs.unshift(newRun);
  return cloneRun(newRun);
};

export const updateRunStatus = (
  projectId: string,
  runId: string,
  status: ProjectRunStatus,
  fields: Partial<Pick<ProjectRunRecord, 'finishedAt' | 'summary' | 'timeline' | 'artifacts'>> = {},
) => {
  const project = inMemoryProjects.find((item) => item.id === projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const run = project.runs.find((item) => item.id === runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  run.status = status;
  if (fields.finishedAt !== undefined) {
    run.finishedAt = fields.finishedAt;
  }
  if (fields.summary !== undefined) {
    run.summary = fields.summary;
  }
  if (fields.timeline !== undefined) {
    run.timeline = fields.timeline;
  }
  if (fields.artifacts !== undefined) {
    run.artifacts = fields.artifacts;
  }

  return cloneRun(run);
};
