import { Router } from 'express';
import { requireAuth, getAuthContext } from '../auth/middleware';
import {
  createProjectRun,
  getProjectDetail,
  getRunDetail,
  listProjectSummaries,
} from '../services/projects';
import { appendValueEvent } from '../events/value-events';

const router = Router();

router.get('/', requireAuth('projects.read'), (req, res) => {
  const projects = listProjectSummaries();
  res.json({
    projects,
    count: projects.length,
    timestamp: new Date().toISOString(),
  });
});

router.get('/:projectId', requireAuth('projects.read'), (req, res) => {
  const { projectId } = req.params;
  const detail = getProjectDetail(projectId);
  if (!detail) {
    return res.status(404).json({
      error: '项目不存在',
      projectId,
    });
  }
  res.json({ project: detail });
});

router.get('/:projectId/runs/:runId', requireAuth('projects.read'), (req, res) => {
  const { projectId, runId } = req.params;
  const run = getRunDetail(projectId, runId);
  if (!run) {
    return res.status(404).json({
      error: '运行记录不存在',
      projectId,
      runId,
    });
  }
  res.json({ run });
});

router.post('/:projectId/runs', requireAuth('projects.execute'), async (req, res) => {
  const { projectId } = req.params;
  const { sourceRunId, title, metadata } = (req.body ?? {}) as {
    sourceRunId?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  };

  const auth = getAuthContext(req);
  const triggeredBy = auth?.subject ?? 'system';

  try {
    const run = createProjectRun(projectId, {
      title,
      sourceRunId,
      metadata,
      triggeredBy,
    });

    await appendValueEvent({
      eventType: sourceRunId ? 'task.replay.requested' : 'task.submitted',
      status: 'pending',
      title: `${run.title} - ${sourceRunId ? '重新执行' : '新任务'}`,
      summary: sourceRunId
        ? `触发对运行 ${sourceRunId} 的重新执行，已排队等待资源`
        : '任务已提交调度，等待执行',
      traceId: run.traceId,
      metadata: {
        projectId,
        runId: run.id,
        sourceRunId,
      },
      actionLabel: '打开回放',
      actionHref: `/projects/${projectId}?run=${run.id}`,
    });

    res.status(201).json({ run });
  } catch (error) {
    console.error('[Projects] 创建运行失败:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : '创建运行失败',
    });
  }
});

export default router;
