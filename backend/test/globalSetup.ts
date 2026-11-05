import pg from 'pg';

/** Fresh schema for every test run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://shareride:shareride@localhost:5432/shareride_test';
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await c.end();
}
