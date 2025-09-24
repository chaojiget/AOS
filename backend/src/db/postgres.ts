import { Pool, PoolConfig } from 'pg';

let pool: Pool | null = null;

const createPool = () => {
  const connectionString = process.env.LANGGRAPH_CHECKPOINT_URL || process.env.CHECKPOINT_DB_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('找不到 Postgres 连接串，请配置 DATABASE_URL 或 LANGGRAPH_CHECKPOINT_URL');
  }

  const ssl = process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : undefined;

  const config: PoolConfig = {
    connectionString,
    ssl,
    max: process.env.DATABASE_POOL_MAX ? Number(process.env.DATABASE_POOL_MAX) : undefined,
  };

  return new Pool(config);
};

export const getPool = () => {
  if (!pool) {
    pool = createPool();
  }
  return pool;
};

export const closePool = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};
