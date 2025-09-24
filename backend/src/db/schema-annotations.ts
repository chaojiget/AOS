import Database from 'better-sqlite3';

type AnnotationScope = 'database' | 'table' | 'column';

interface SchemaAnnotation {
  scope: AnnotationScope;
  name: string;
  parent?: string;
  label: string;
  description: string;
  tags: string[];
}

const ANNOTATIONS: SchemaAnnotation[] = [
  {
    scope: 'database',
    name: 'main',
    label: 'AOS 会话检查点库',
    description: 'LangGraph SqliteSaver 生成的主数据库，用于持久化聊天流程的检查点与写入事件，以便故障恢复和会话追踪。',
    tags: ['checkpoint', 'langgraph', 'runtime-state'],
  },
  {
    scope: 'table',
    parent: 'main',
    name: 'checkpoints',
    label: '检查点快照表',
    description: '保存每个对话线程在不同命名空间下的状态快照，支持在任意节点恢复 LangGraph 对话流程。',
    tags: ['snapshot', 'graph-state'],
  },
  {
    scope: 'column',
    parent: 'checkpoints',
    name: 'thread_id',
    label: '线程标识',
    description: 'LangGraph 对话线程的唯一 ID，对应会话或任务上下文。',
    tags: ['primary-key', 'context'],
  },
  {
    scope: 'column',
    parent: 'checkpoints',
    name: 'checkpoint_ns',
    label: '命名空间',
    description: 'Checkpoint 命名空间，区分同一线程下的不同流程或分支。',
    tags: ['namespace'],
  },
  {
    scope: 'column',
    parent: 'checkpoints',
    name: 'checkpoint_id',
    label: '检查点 ID',
    description: '当前快照的唯一 ID，与 thread_id + checkpoint_ns 共同组成主键。',
    tags: ['primary-key'],
  },
  {
    scope: 'column',
    parent: 'checkpoints',
    name: 'parent_checkpoint_id',
    label: '父级检查点',
    description: '指向上一个检查点 ID，用于回溯或构建检查点链路。',
    tags: ['lineage'],
  },
  {
    scope: 'column',
    parent: 'checkpoints',
    name: 'type',
    label: '快照类型',
    description: 'LangGraph 序列化的节点类型或状态类型，辅助恢复时的执行逻辑。',
    tags: ['metadata'],
  },
  {
    scope: 'column',
    parent: 'checkpoints',
    name: 'checkpoint',
    label: '状态数据',
    description: '序列化后的对话状态二进制数据（BLOB），包含消息、工具调用等上下文。',
    tags: ['blob', 'state'],
  },
  {
    scope: 'column',
    parent: 'checkpoints',
    name: 'metadata',
    label: '附加元数据',
    description: '序列化的元数据字段，存放流程控制或自定义扩展信息。',
    tags: ['blob', 'metadata'],
  },
  {
    scope: 'table',
    parent: 'main',
    name: 'writes',
    label: '增量写入表',
    description: '记录节点执行过程中的逐步写入（如事件流、消息追加），支持回放与状态重建。',
    tags: ['event-log', 'graph-state'],
  },
  {
    scope: 'column',
    parent: 'writes',
    name: 'thread_id',
    label: '线程标识',
    description: '对应检查点表的 thread_id，标识属于哪个对话线程。',
    tags: ['foreign-key', 'context'],
  },
  {
    scope: 'column',
    parent: 'writes',
    name: 'checkpoint_ns',
    label: '命名空间',
    description: '与 checkpoints 表中同名字段一致，确保写入记录与具体命名空间关联。',
    tags: ['namespace'],
  },
  {
    scope: 'column',
    parent: 'writes',
    name: 'checkpoint_id',
    label: '检查点 ID',
    description: '关联到某个具体检查点的写入记录，便于回放生成最终状态。',
    tags: ['foreign-key'],
  },
  {
    scope: 'column',
    parent: 'writes',
    name: 'task_id',
    label: '任务 ID',
    description: 'LangGraph 中的任务或节点标识，用于区分不同执行分支。',
    tags: ['task', 'execution'],
  },
  {
    scope: 'column',
    parent: 'writes',
    name: 'idx',
    label: '写入序号',
    description: '同一任务下的事件顺序号，保证增量数据的时间顺序。',
    tags: ['ordering'],
  },
  {
    scope: 'column',
    parent: 'writes',
    name: 'channel',
    label: '写入通道',
    description: '记录写入所属的通道（如 `messages`、`tools`），用于还原不同类型的输出。',
    tags: ['channel', 'categorization'],
  },
  {
    scope: 'column',
    parent: 'writes',
    name: 'type',
    label: '数据类型',
    description: '序列化内容对应的业务类型或模型输出类型，指导解析方式。',
    tags: ['metadata'],
  },
  {
    scope: 'column',
    parent: 'writes',
    name: 'value',
    label: '写入值',
    description: 'BLOB 形式的序列化写入数据，是回放构建状态所需的原始记录。',
    tags: ['blob', 'state'],
  },
];

export const ensureCheckpointSchemaAnnotations = (dbPath: string) => {
  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_annotations (
        scope TEXT NOT NULL,
        name TEXT NOT NULL,
        parent TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL,
        description TEXT NOT NULL,
        tags TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (scope, name, parent)
      );
    `);

    const upsert = db.prepare(`
      INSERT INTO schema_annotations (scope, name, parent, label, description, tags, updated_at)
      VALUES (@scope, @name, @parent, @label, @description, @tags, @updatedAt)
      ON CONFLICT(scope, name, parent) DO UPDATE SET
        label = excluded.label,
        description = excluded.description,
        tags = excluded.tags,
        updated_at = excluded.updated_at
    `);

    const now = Date.now();
    const insertMany = db.transaction((annotations: SchemaAnnotation[]) => {
      for (const annotation of annotations) {
        upsert.run({
          scope: annotation.scope,
          name: annotation.name,
          parent: annotation.parent ?? (annotation.scope === 'database' ? '' : 'main'),
          label: annotation.label,
          description: annotation.description,
          tags: JSON.stringify(annotation.tags),
          updatedAt: now,
        });
      }
    });

    insertMany(ANNOTATIONS);
  } finally {
    db?.close();
  }
};

export const ensureCheckpointSchemaAnnotationsSafe = (dbPath: string) => {
  try {
    ensureCheckpointSchemaAnnotations(dbPath);
  } catch (error) {
    console.warn('[schema-annotations] 注释同步失败:', error);
  }
};
