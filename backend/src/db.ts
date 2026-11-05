import pg from 'pg';
import { config } from './config';

// BIGINT (int8) → JS number. Safe: amounts are minor units far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
// NUMERIC → number (ratings, FX rates; display-only).
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 20 });

export type Db = pg.Pool | pg.PoolClient;

/** Parameterised query helper — never interpolate user input into SQL. */
export async function q<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const res = await db.query<T>(text, params as any[]);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool): Promise<T | undefined> {
  return (await q<T>(text, params, db))[0];
}

/**
 * Run `fn` in a transaction. Used for every financial and seat-allocation operation (spec §85).
 * Retries once on serialization failures / deadlocks.
 */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (attempt < 1 && (e.code === '40001' || e.code === '40P01')) continue;
      throw e;
    } finally {
      client.release();
    }
  }
}
