import { pool } from "../database/pool.js";
import { ensureAuction, settleDueAuctions } from "../economy/auction-service.js";
import { refreshActiveSince } from "../economy/progress.js";
import type { RoomRegistry } from "../games/rooms/room-registry.js";
import { logger } from "../logging/logger.js";
import { reapIdleCustomRooms } from "../rooms/custom-room-service.js";
import { errorText, sendAlert } from "./alerts.js";
import { awardSeason, awardWeekly } from "./awards.js";
import { auctionWeek, dailyAt5, kstDayStart, lastMonth, lastWeek, slotKey } from "./kst-periods.js";

/**
 * 자동 운영(스펙 §11) — API 프로세스 안에서 1분마다 돌 차례인 작업을 하나씩 차례로 돌린다(한 프로세스에서 둘이 겹치지 않게).
 * 작업마다 "지금 → 기간 키"가 있고, job_runs(name, period_key) 에 줄을 넣는 데 성공했을 때만 돈다 — 재시작해도
 * 같은 기간(주간 칭호의 그 주 등)에 두 번 돌지 않고, 서버가 꺼져 있던 동안 놓친 기간은 다시 뜬 뒤 첫 틱에 돈다.
 * 실패하면 줄을 지워 다음 틱에 다시 하고, 알림을 보낸다. 끝나지 않은 채 30분이 지난 줄은 돌다 죽은 것으로 보고 다시 잡는다.
 */

export interface Job {
  name: string;
  /** 지금 돌 차례인 기간 키. null 이면 아직 아니다. */
  period(now: Date): string | null;
  run(now: Date): Promise<void>;
}

/** 돌 차례인 작업을 차례로 돌리고, 실제로 돈 작업 이름을 돌려준다. */
export async function runDueJobs(jobs: readonly Job[], now: Date): Promise<string[]> {
  const ran: string[] = [];
  for (const job of jobs) {
    const key = job.period(now);
    if (key === null) continue;
    const claimed = await pool.query(
      `INSERT INTO job_runs (name, period_key) VALUES ($1,$2)
       ON CONFLICT (name, period_key) DO UPDATE SET started_at=now()
         WHERE job_runs.finished_at IS NULL AND job_runs.started_at < now() - interval '30 minutes'
       RETURNING 1`,
      [job.name, key],
    );
    if (!claimed.rowCount) continue;
    try {
      await job.run(now);
      await pool.query("UPDATE job_runs SET finished_at=now() WHERE name=$1 AND period_key=$2", [job.name, key]);
      ran.push(job.name);
    } catch (error) {
      logger.error("scheduled job failed", { job: job.name, period: key, err: error });
      await pool.query("DELETE FROM job_runs WHERE name=$1 AND period_key=$2", [job.name, key]).catch(() => undefined);
      void sendAlert(`[OpenCasino] 작업 실패: ${job.name} (${key}) — ${errorText(error)}`);
    }
  }
  return ran;
}

/** 자주 도는 작업. 기록이 하루 1,700줄씩 쌓이니 일일 정리가 이틀 지난 것을 지운다. */
const FREQUENT_JOBS = ["progress", "rooms-idle"];

/** 운영 작업 목록. */
export function opsJobs(rooms: RoomRegistry): Job[] {
  return [
    {
      name: "rooms-idle",
      period: (now) => slotKey(now, 1),
      run: async () => {
        const closed = await reapIdleCustomRooms(rooms);
        if (closed > 0) logger.info("closed idle custom rooms", { closed });
      },
    },
    {
      // 지난번에 끝난 갱신이 시작한 때부터 판이 정산됐거나 코인을 쓴 사람만 다시 센다(처음이면 전부). 1분 겹쳐 잡는다 —
      // 정산 트랜잭션이 settled_at 을 적고 조금 늦게 커밋돼도 놓치지 않게.
      name: "progress",
      period: (now) => slotKey(now, 5),
      run: async () => {
        const last = await pool.query<{ at: Date | null }>("SELECT max(started_at) AS at FROM job_runs WHERE name='progress' AND finished_at IS NOT NULL");
        await refreshActiveSince(new Date(last.rows[0]?.at ? last.rows[0].at.getTime() - 60_000 : 0));
      },
    },
    {
      // 키가 바뀌는 때(일요일 21:00 KST)가 지난 경매를 정산하고 다음 주 경매를 여는 때다.
      name: "auction",
      period: (now) => auctionWeek(now).key,
      run: async (now) => {
        await settleDueAuctions(now);
        await ensureAuction(now);
      },
    },
    {
      // 방·로비 채팅은 오늘(KST) 이전 것, PvP 판 기록 14일(참가자 줄은 FK CASCADE 로 함께). 1:1 메시지·고객센터는 지우지 않는다(0016 결정) —
      // 고객센터 대화도 chat_messages 에 있지만 conversation_id 가 있다. 화면에서는 자정에 이미 사라져 있다(chat-service).
      name: "daily-cleanup",
      period: dailyAt5,
      run: async (now) => {
        const chat = await pool.query("DELETE FROM chat_messages WHERE conversation_id IS NULL AND created_at < $1", [kstDayStart(now)]);
        const hands = await pool.query("DELETE FROM pvp_hand_logs WHERE ended_at < now() - interval '14 days'");
        await pool.query("DELETE FROM job_runs WHERE name = ANY($1::text[]) AND started_at < now() - interval '2 days'", [FREQUENT_JOBS]);
        logger.info("daily cleanup", { roomChat: chat.rowCount, handLogs: hands.rowCount });
      },
    },
    {
      name: "weekly-awards",
      period: (now) => lastWeek(now)?.key ?? null,
      run: async (now) => {
        const granted = await awardWeekly(lastWeek(now)!, now);
        logger.info("weekly awards", { granted: granted.length });
      },
    },
    {
      name: "season-awards",
      period: (now) => lastMonth(now)?.key ?? null,
      run: async (now) => {
        const granted = await awardSeason(lastMonth(now)!);
        logger.info("season awards", { granted: granted.length });
      },
    },
  ];
}

/** 기동 5초 뒤 첫 틱, 그 뒤 1분마다. 멈추는 함수를 돌려준다. */
export function startScheduler(jobs: readonly Job[], intervalMs = 60_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDueJobs(jobs, new Date());
    } catch (error) {
      logger.error("scheduler tick failed", { err: error });
      void sendAlert(`[OpenCasino] 스케줄러 오류 — ${errorText(error)}`);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void tick(), 5_000);
  const timer = setInterval(() => void tick(), intervalMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
