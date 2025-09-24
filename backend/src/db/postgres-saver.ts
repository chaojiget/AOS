import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  TASKS,
  copyCheckpoint,
  type Checkpoint,
  type CheckpointPendingWrite,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  type SerializerProtocol,
} from '@langchain/langgraph-checkpoint';
import type { Pool, PoolClient } from 'pg';

interface CheckpointRow {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  type: string | null;
  checkpoint: Buffer;
  metadata: Buffer | null;
}

interface WriteRow {
  task_id: string;
  channel: string;
  type: string | null;
  value: Buffer | null;
  idx: number;
}

const sanitizeNamespace = (value: string | undefined | null) => value ?? '';

const bufferFrom = (data: Uint8Array | Buffer): Buffer => {
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
};

export class PostgresSaver extends BaseCheckpointSaver {
  private readonly pool: Pool;
  private isSetup = false;

  constructor(pool: Pool, serde?: SerializerProtocol) {
    super(serde);
    this.pool = pool;
  }

  static fromPool(pool: Pool, serde?: SerializerProtocol) {
    return new PostgresSaver(pool, serde);
  }

  async setup(): Promise<void> {
    if (this.isSetup) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        type TEXT,
        checkpoint BYTEA NOT NULL,
        metadata BYTEA,
        metadata_json JSONB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      );
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        type TEXT,
        value BYTEA,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      );
    `);
    this.isSetup = true;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    await this.setup();
    const { thread_id, checkpoint_ns, checkpoint_id } = config.configurable ?? {} as Record<string, string | undefined>;
    if (!thread_id) {
      return undefined;
    }

    const args: Array<string> = [thread_id, sanitizeNamespace(checkpoint_ns)];
    let query = `
      SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
      FROM checkpoints
      WHERE thread_id = $1 AND checkpoint_ns = $2
    `;

    if (checkpoint_id) {
      args.push(checkpoint_id);
      query += ' AND checkpoint_id = $3';
    } else {
      query += ' ORDER BY checkpoint_id DESC LIMIT 1';
    }

    const client = await this.pool.connect();
    try {
      const rowRes = await client.query<CheckpointRow>(query, args);
      if (rowRes.rows.length === 0) {
        return undefined;
      }
      const row = rowRes.rows[0];

      const configResult = checkpoint_id
        ? config
        : {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns: sanitizeNamespace(checkpoint_ns),
              checkpoint_id: row.checkpoint_id,
            },
          };

      const pendingWrites = await this.loadPendingWrites(client, row.thread_id, row.checkpoint_ns, row.checkpoint_id);
      const pendingSends = row.parent_checkpoint_id
        ? await this.loadPendingSends(client, row.thread_id, row.checkpoint_ns, row.parent_checkpoint_id)
        : [];

      const checkpoint: Checkpoint = {
        ...(await this.serde.loadsTyped(row.type ?? 'json', row.checkpoint)),
        pending_sends: pendingSends,
      };

      const metadataBuf = row.metadata;
      const metadata = metadataBuf
        ? await this.serde.loadsTyped(row.type ?? 'json', metadataBuf)
        : undefined;

      return {
        checkpoint,
        config: configResult,
        metadata: metadata as CheckpointMetadata,
        parentConfig: row.parent_checkpoint_id
          ? {
              configurable: {
                thread_id: row.thread_id,
                checkpoint_ns: sanitizeNamespace(checkpoint_ns),
                checkpoint_id: row.parent_checkpoint_id,
              },
            }
          : undefined,
        pendingWrites,
      };
    } finally {
      client.release();
    }
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    await this.setup();
    const { limit, before, filter } = options ?? {};
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns;

    const params: Array<string | number> = [];
    const where: string[] = [];

    if (threadId) {
      params.push(threadId);
      where.push(`thread_id = $${params.length}`);
    }

    if (checkpointNs !== undefined) {
      params.push(sanitizeNamespace(checkpointNs));
      where.push(`checkpoint_ns = $${params.length}`);
    }

    if (before?.configurable?.checkpoint_id) {
      params.push(before.configurable.checkpoint_id);
      where.push(`checkpoint_id < $${params.length}`);
    }

    if (filter) {
      Object.entries(filter).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          const keyIndex = params.push(key);
          const valueIndex = params.push(String(value));
          where.push(`metadata_json ->> $${keyIndex} = $${valueIndex}`);
        }
      });
    }

    let query = `
      SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
      FROM checkpoints
    `;

    if (where.length > 0) {
      query += `WHERE ${where.join(' AND ')}\n`;
    }

    query += 'ORDER BY checkpoint_id DESC';

    if (limit) {
      params.push(limit);
      query += ` LIMIT $${params.length}`;
    }

    const client = await this.pool.connect();
    try {
      const rows = await client.query<CheckpointRow>(query, params);

      for (const row of rows.rows) {
        const pendingWrites = await this.loadPendingWrites(client, row.thread_id, row.checkpoint_ns, row.checkpoint_id);
        const pendingSends = row.parent_checkpoint_id
          ? await this.loadPendingSends(client, row.thread_id, row.checkpoint_ns, row.parent_checkpoint_id)
          : [];

        const checkpoint: Checkpoint = {
          ...(await this.serde.loadsTyped(row.type ?? 'json', row.checkpoint)),
          pending_sends: pendingSends,
        };

        const metadataBuf = row.metadata;
        const metadata = metadataBuf
          ? await this.serde.loadsTyped(row.type ?? 'json', metadataBuf)
          : undefined;

        yield {
          checkpoint,
          config: {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns: row.checkpoint_ns,
              checkpoint_id: row.checkpoint_id,
            },
          },
          metadata: metadata as CheckpointMetadata,
          parentConfig: row.parent_checkpoint_id
            ? {
                configurable: {
                  thread_id: row.thread_id,
                  checkpoint_ns: row.checkpoint_ns,
                  checkpoint_id: row.parent_checkpoint_id,
                },
              }
            : undefined,
          pendingWrites,
        };
      }
    } finally {
      client.release();
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions?: Record<string, unknown>
  ): Promise<RunnableConfig> {
    await this.setup();
    if (!config.configurable?.thread_id) {
      throw new Error('Missing "thread_id" field in config.configurable.');
    }

    const threadId = config.configurable.thread_id;
    const checkpointNs = sanitizeNamespace(config.configurable.checkpoint_ns);
    const parentCheckpointId = config.configurable.checkpoint_id ?? null;

    const preparedCheckpoint = copyCheckpoint(checkpoint);
    preparedCheckpoint.pending_sends = [];

    const [checkpointType, serializedCheckpoint] = this.serde.dumpsTyped(preparedCheckpoint);
    const [metadataType, serializedMetadata] = this.serde.dumpsTyped(metadata);

    if (checkpointType !== metadataType) {
      throw new Error('Failed to serialize checkpoint and metadata to the same type.');
    }

    const metadataJson = this.tryParseJson(metadataType, serializedMetadata);

    await this.pool.query(
      `INSERT INTO checkpoints (
        thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata, metadata_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id) DO UPDATE SET
        parent_checkpoint_id = EXCLUDED.parent_checkpoint_id,
        type = EXCLUDED.type,
        checkpoint = EXCLUDED.checkpoint,
        metadata = EXCLUDED.metadata,
        metadata_json = EXCLUDED.metadata_json,
        checkpoint_id = EXCLUDED.checkpoint_id
    `,
      [
        threadId,
        checkpointNs,
        checkpoint.id,
        parentCheckpointId,
        checkpointType,
        bufferFrom(serializedCheckpoint),
        serializedMetadata ? bufferFrom(serializedMetadata) : null,
        metadataJson,
      ]
    );

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    await this.setup();
    if (!config.configurable?.thread_id) {
      throw new Error('Missing thread_id field in config.configurable.');
    }
    if (!config.configurable?.checkpoint_id) {
      throw new Error('Missing checkpoint_id field in config.configurable.');
    }

    const threadId = config.configurable.thread_id;
    const checkpointNs = sanitizeNamespace(config.configurable.checkpoint_ns);
    const checkpointId = config.configurable.checkpoint_id;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const stmt = `
        INSERT INTO writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id, task_id, idx) DO UPDATE SET
          channel = EXCLUDED.channel,
          type = EXCLUDED.type,
          value = EXCLUDED.value
      `;

      for (const [index, write] of writes.entries()) {
        const [channel, value] = write;
        const [valueType, serializedValue] = this.serde.dumpsTyped(value);

        await client.query(stmt, [
          threadId,
          checkpointNs,
          checkpointId,
          taskId,
          index,
          channel,
          valueType,
          serializedValue ? bufferFrom(serializedValue) : null,
        ]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private tryParseJson(type: string, data: Uint8Array | Buffer | undefined | null) {
    if (!data) return null;
    if (type !== 'json') return null;
    try {
      const jsonString = bufferFrom(data).toString('utf8');
      return JSON.parse(jsonString);
    } catch (error) {
      console.warn('[PostgresSaver] 无法解析 metadata JSON:', error);
      return null;
    }
  }

  private async loadPendingWrites(
    client: PoolClient,
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): Promise<CheckpointPendingWrite[]> {
    const res = await client.query<WriteRow>(
      `SELECT task_id, channel, type, value, idx
       FROM writes
       WHERE thread_id = $1 AND checkpoint_ns = $2 AND checkpoint_id = $3
       ORDER BY idx ASC`,
      [threadId, checkpointNs, checkpointId]
    );

    return Promise.all(
      res.rows.map(async (row): Promise<CheckpointPendingWrite> => [
        row.task_id,
        row.channel,
        await this.serde.loadsTyped(row.type ?? 'json', row.value ?? Buffer.from('null')),
      ])
    );
  }

  private async loadPendingSends(
    client: PoolClient,
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): Promise<unknown[]> {
    const res = await client.query<WriteRow>(
      `SELECT type, value
       FROM writes
       WHERE thread_id = $1 AND checkpoint_ns = $2 AND checkpoint_id = $3 AND channel = $4
       ORDER BY idx ASC`,
      [threadId, checkpointNs, checkpointId, TASKS]
    );

    return Promise.all(
      res.rows.map((row) => this.serde.loadsTyped(row.type ?? 'json', row.value ?? Buffer.from('null')))
    );
  }
}
