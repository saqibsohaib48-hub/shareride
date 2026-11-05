import type { Request } from 'express';
import { Db, pool, q } from '../db';

/** Append-only audit trail (spec §70). */
export async function audit(
  action: string,
  opts: { actorId?: string | null; actorRole?: string | null; entityType?: string; entityId?: string; data?: unknown; req?: Request; db?: Db } = {},
) {
  await q(
    `INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, data, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [opts.actorId ?? null, opts.actorRole ?? null, action, opts.entityType ?? null, opts.entityId ?? null,
     JSON.stringify(opts.data ?? {}), opts.req?.ip?.replace('::ffff:', '') ?? null],
    opts.db ?? pool,
  );
}
