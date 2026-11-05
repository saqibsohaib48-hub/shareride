import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db';

/** Minimal forward-only migrator: applies database/migrations/*.sql in order, once each. */
export async function migrate(log = true) {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations');
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set((await pool.query(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name));
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
      await client.query('COMMIT');
      if (log) console.log(`applied ${file}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
