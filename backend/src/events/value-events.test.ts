import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapNotificationPayload } from './value-events';

describe('mapNotificationPayload', () => {
  it('能解析 JSON 字符串并填充默认字段', () => {
    const payload = JSON.stringify({
      id: 123,
      eventType: 'task.progress',
      status: '  ',
      title: '处理进度更新',
      summary: '任务已完成 50%',
      traceId: 'trace-001',
      occurredAt: '2024-10-01T00:00:00.000Z',
      action: {
        label: '查看详情',
        href: '/projects/foo?run=bar',
      },
      metadata: { foo: 'bar' },
    });

    const result = mapNotificationPayload(payload);

    assert.equal(result.id, '123');
    assert.equal(result.eventType, 'task.progress');
    assert.equal(result.status, 'active');
    assert.equal(result.title, '处理进度更新');
    assert.equal(result.summary, '任务已完成 50%');
    assert.equal(result.traceId, 'trace-001');
    assert.equal(result.occurredAt, '2024-10-01T00:00:00.000Z');
    assert.deepEqual(result.metadata, { foo: 'bar' });
    assert.deepEqual(result.action, { label: '查看详情', href: '/projects/foo?run=bar' });
  });

  it('在收到无法解析的内容时返回安全默认值', () => {
    const resultFromText = mapNotificationPayload('not-json');
    assert.equal(resultFromText.title, '解析通知失败');
    assert.equal(resultFromText.status, 'active');

    const resultFromUnknown = mapNotificationPayload(42 as unknown);
    assert.equal(resultFromUnknown.title, '未知事件');
    assert.equal(resultFromUnknown.summary, '无法解析价值事件通知。');
  });

  it('优先读取顶层动作字段作为兜底', () => {
    const result = mapNotificationPayload({
      id: 'abc',
      eventType: 'task.completed',
      status: 'done',
      title: '运行完成',
      actionLabel: '查看回放',
      actionHref: '/projects/foo?run=bar',
      action: {
        label: 123,
        href: null,
      },
    });

    assert.equal(result.action.label, '查看回放');
    assert.equal(result.action.href, '/projects/foo?run=bar');
  });
});
