import type { GameType, HandLogEvent, HandLogResponse } from "@opencasino/contracts";
import { pool } from "../database/pool.js";
import { logger } from "../logging/logger.js";

/**
 * PvP 판 기록기 — 판이 열릴 때 방 액터가 하나 만들고, 딜·베팅·공개·정산 같은 사건을 차례로 쌓은 뒤
 * 정산이 끝나면 save() 로 한 번에 DB(pvp_hand_logs, 0014_hand_logs)에 적는다.
 *
 * 홀덤의 "지난 핸드"는 방 메모리에 12판뿐이라 재시작하면 사라졌고, 담합·봇 의혹이 나와도 사후에 판을
 * 다시 볼 수 없었다. 여기엔 자리별 비공개 패까지 전부 남긴다 — 그래서 그대로 내보내지 않고, 보는
 * 사람마다 maskHandLogEvents 로 가린다.
 *
 * 기록은 판 진행·정산을 절대 깨면 안 된다: push 는 던질 일이 없고, save 는 실패를 로그로만 남긴다.
 * 환불로 끝난 판(복구 경로)은 save 를 부르지 않으므로 남지 않는다 — 정산이 끝난 판만 기록이다.
 * 새 게임은 같은 방식으로 붙인다: 판 시작에 new HandLog, 사건마다 push, 정산 뒤 save(7포커·바둑이도 이렇게 붙었다).
 */
export class HandLog {
  readonly events: HandLogEvent[] = [];
  private readonly startedAt = new Date();

  constructor(private readonly meta: { roundId: string; gameType: GameType; roomId: string; variant: string | null; rulesVersion: string }) {}

  get roundId(): string {
    return this.meta.roundId;
  }

  /** 복사해서 쌓는다 — 방 상태의 배열(손패 등)을 그대로 넣으면 판이 진행되며 지난 사건이 바뀐다. */
  push(event: HandLogEvent): void {
    this.events.push(structuredClone(event));
  }

  /** 정산이 끝난 판을 한 문장(로그 + 참가자)으로 적는다. 같은 판을 두 번 적으면 두 번째는 아무 일도 없다. */
  async save(participants: Array<{ userId: string; seatNumber: number; netMinor: number }>): Promise<void> {
    try {
      await pool.query(
        `WITH log AS (
           INSERT INTO pvp_hand_logs (round_id,game_type,room_id,variant,started_at,events,rules_version)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT (round_id) DO NOTHING RETURNING round_id
         )
         INSERT INTO pvp_hand_participants (round_id,user_id,seat_number,net_minor)
         SELECT log.round_id, p.user_id, p.seat_number, p.net_minor
         FROM log, unnest($8::uuid[], $9::smallint[], $10::bigint[]) AS p(user_id, seat_number, net_minor)`,
        [
          this.meta.roundId, this.meta.gameType, this.meta.roomId, this.meta.variant, this.startedAt, JSON.stringify(this.events), this.meta.rulesVersion,
          participants.map((p) => p.userId), participants.map((p) => p.seatNumber), participants.map((p) => Math.round(p.netMinor)),
        ],
      );
    } catch (error) {
      logger.error("failed to save hand log", { roundId: this.meta.roundId, game: this.meta.gameType, err: error });
    }
  }
}

/**
 * 보는 사람별 가리기 — 일반 사용자는 자기 패와 쇼다운에서 실제로 깐 패만 본다. 관리자는 전부.
 *
 * - deal·pick(비공개 패)은 그 자리 주인에게만 그대로, 남에게는 같은 장수의 null(뒷면)로. 앞면으로 받은
 *   deal(open, 7포커 4구~6구)은 판 위에서도 모두가 보던 패라 그대로 둔다.
 * - draw(바둑이 교체·7포커 초이스의 버린 패)는 남에게 장수만 — 버린 패·받은 패 둘 다 null 로.
 * - show 는 쇼다운까지 간 자리만 적히지만, 혹시 접은 자리의 공개가 섞여 들어와도 남에게는 내보내지 않는다
 *   (재경기는 모두 다시 받으므로 접힘 표시를 지운다).
 */
export function maskHandLogEvents(events: readonly HandLogEvent[], viewer: { seat: number | null; admin: boolean }): HandLogEvent[] {
  if (viewer.admin) return [...events];
  const folded = new Set<number>();
  const visible: HandLogEvent[] = [];
  for (const event of events) {
    if (event.t === "redeal") folded.clear();
    if (event.t === "action" && (event.action === "fold" || event.action === "die")) folded.add(event.seat);
    if (((event.t === "deal" && !event.open) || event.t === "pick") && event.seat !== viewer.seat) {
      visible.push({ ...event, cards: event.cards.map(() => null) });
      continue;
    }
    if (event.t === "draw" && event.seat !== viewer.seat) {
      visible.push({ ...event, discarded: event.discarded.map(() => null), received: event.received.map(() => null) });
      continue;
    }
    if (event.t === "show" && event.seat !== viewer.seat && folded.has(event.seat)) continue;
    visible.push(event);
  }
  return visible;
}

/** GET /api/v1/hands/:roundId — 참가자 또는 관리자만. 아니면(또는 기록이 없으면) null → 404. */
export async function loadHandLog(roundId: string, viewer: { userId: string; admin: boolean }): Promise<HandLogResponse | null> {
  const [logRows, seatRows] = await Promise.all([
    pool.query<{ game_type: GameType; room_name: string; variant: string | null; started_at: Date; ended_at: Date; events: HandLogEvent[] }>(
      `SELECT l.game_type,gr.name AS room_name,l.variant,l.started_at,l.ended_at,l.events
       FROM pvp_hand_logs l JOIN game_rooms gr ON gr.id=l.room_id WHERE l.round_id=$1`,
      [roundId],
    ),
    pool.query<{ seat_number: number }>("SELECT seat_number FROM pvp_hand_participants WHERE round_id=$1 AND user_id=$2", [roundId, viewer.userId]),
  ]);
  const row = logRows.rows[0];
  if (!row) return null;
  const viewerSeat = seatRows.rows[0]?.seat_number ?? null;
  if (viewerSeat === null && !viewer.admin) return null;
  return {
    roundId,
    game: row.game_type,
    roomName: row.room_name,
    variant: row.variant,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at.toISOString(),
    viewerSeat,
    events: maskHandLogEvents(row.events, { seat: viewerSeat, admin: viewer.admin }),
  };
}
