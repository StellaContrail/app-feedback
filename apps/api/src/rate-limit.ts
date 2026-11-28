import { hash } from "./crypto";
export async function budget(
  db: D1Database,
  identity: string,
  maximum: number,
): Promise<boolean> {
  const now = Date.now(),
    window = Math.floor(now / 60000);
  const bucket = await hash(`${identity}:${window}`);
  await db
    .prepare("DELETE FROM request_limits WHERE expires_at < ?")
    .bind(now)
    .run();
  const row = await db
    .prepare(
      "INSERT INTO request_limits(bucket,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts",
    )
    .bind(bucket, (window + 2) * 60000)
    .first<{ attempts: number }>();
  return !!row && row.attempts <= maximum;
}
