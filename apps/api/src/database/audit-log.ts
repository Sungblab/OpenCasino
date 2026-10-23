import type { PoolClient } from "pg";
import { pool } from "./pool.js";

type Queryable = Pick<PoolClient, "query">;

/**
 * 관리자가 무언가를 바꾼 기록 한 줄(audit_logs). action 은 대문자 스네이크(USER_ROLE_CHANGED 등),
 * details 에는 바뀐 값을 전/후로 남긴다 — 관리자 화면의 감사 로그가 그대로 읽어 한 줄 요약을 만든다.
 *
 * 바뀐 상태가 DB 에 있으면 그 변경과 같은 트랜잭션의 client 로 부른다. 따로 적으면 변경은 됐는데
 * 기록이 빠지거나(커밋 뒤 INSERT 실패), 롤백됐는데 기록만 남는 틈이 생긴다.
 */
export async function writeAuditLog(
  db: Queryable,
  entry: { actorId: string; action: string; targetType?: "user" | "room" | "house"; targetId?: string; details?: Record<string, unknown> },
): Promise<void> {
  await db.query(
    "INSERT INTO audit_logs (actor_user_id,action,target_type,target_id,details) VALUES ($1,$2,$3,$4,$5)",
    [entry.actorId, entry.action, entry.targetType ?? null, entry.targetId ?? null, JSON.stringify(entry.details ?? {})],
  );
}

/** 짧은 트랜잭션 하나. 상태 변경과 그 감사 기록이 같이 남거나 같이 사라지게 묶을 때 쓴다. */
export async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
