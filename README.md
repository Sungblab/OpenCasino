# OpenCasino

> **플레이머니 전용 프로젝트입니다. 실제 돈 충전·입금, 출금·환전·현금화, 코인 구매 또는 결제 기능을 만들거나 추가하지 마세요.**
> 코인은 무료 게임용이며 현금 가치나 현금 교환 수단이 없습니다. 이 원칙은 코드, 설정, 문서, 기여 전부에 적용됩니다.
>
> **Play-money only. Do not add real-money deposits, top-ups, withdrawals, cash-outs, coin purchases, or payment processing.**
> Coins are free game credits with no cash value or redemption path.

코인 원장 위에서 도는 실시간 카지노·보드게임 플랫폼. 바카라(일반·보너스·라이트닝), 드래곤 타이거,
블랙잭(일반·라이트닝), 텍사스 홀덤·섯다·고스톱 PvP(AI 봇 포함)를 한 서버가 돌린다.

- **서버 권위형**: 카드·결과·정산은 서버가 정하고, 화면은 서버가 보내는 스냅샷을 그린다.
- **복식 원장**: 잔액을 직접 고치지 않는다. 모든 돈의 이동은 합이 0 인 원장 거래이고, DB 트리거가
  균형과 잔액 캐시를 검사한다. 모든 베팅 명령은 `requestId` 로 멱등이다.

## 구조

| 경로 | 내용 |
| --- | --- |
| `apps/api` | Express 4 + Socket.IO 4 + PostgreSQL. HTTP API, 실시간 게임 방, 원장 |
| `apps/api/src/database` | 연결 풀, 마이그레이션(`migrations/`, `migrator.ts`), 시드 |
| `apps/api/test-integration` | 실제 PostgreSQL·API 프로세스로 도는 통합 테스트 |
| `apps/web` | React + Vite 웹 |
| `packages/contracts` | 서버·웹 공용 타입과 zod 스키마(소켓 이벤트, 스냅샷) |
| `packages/game-core` | DB·네트워크와 분리된 순수 게임 규칙(슈, 족보, 지급표, 카드 공개 시간표) |
| `scripts/` | 빌드(`build-api.mjs`), 부하 테스트(`load/bet-load.mjs`) |

## 로컬 실행

필요한 것: Node 22, PostgreSQL 16 이상(도커가 있으면 `npm run db:up` 이 17 을 띄운다).

```bash
npm ci
cp .env.example .env        # 로컬 기본값 그대로 써도 된다(.env.example 의 설명 참고)

npm run db:up               # 도커로 PostgreSQL(opencasino/opencasino, DB opencasino). 로컬 PostgreSQL 이면 생략
npm run db:migrate          # 아직 안 적용한 마이그레이션만 적용
npm run db:seed             # 게임 방·시스템 지갑(멱등, 여러 번 돌려도 된다)
npm run dev                 # API :5100 + 웹 :5173
```

- API 는 `apps/api` 를 작업 폴더로 돌므로 `apps/api/.env`(또는 셸 환경변수)를 읽는다. 코드 기본값이 로컬
  개발값과 같아서 보통 필요 없다. 웹 개발 서버는 `apps/web/.env.local` 또는 루트 `.env` 의 `VITE_API_URL` 을 읽는다.
- 시드는 사용자를 만들지 않는다. 화면에서 가입한 뒤(공개 운영이면 바로 승인된다) 관리자로 올린다:
  `psql -h 127.0.0.1 -U opencasino opencasino -c "UPDATE users SET role='admin', approved=true WHERE username='내아이디'"`
- 마이그레이션 상태: `npm run db:migrate:status`

## 플레이머니 운영과 방 만들기

이 프로젝트는 **무료 플레이머니 전용**이다. 운영 모드는 설정으로 바꿀 수 없고, 오래된 `PLAY_MONEY_MODE=0` 값도 무시한다. 입금·출금 요청 API는 거절되며 관리자는 요청을 승인할 수 없다.

- 코인에는 현금 가치, 구매·환급·교환 경로가 없다. 결제 대행사나 외부 금융 서비스도 연결하지 않는다. 코인은 **하루 무료 코인**(하루 한 번 잔액을
  `DAILY_COINS_TARGET`=1,000코인까지 채움), 데일리 미션, 관리자 지급으로만 생긴다.
- 가입하면 바로 로그인할 수 있다(`AUTO_APPROVE_SIGNUPS`, 기본값은 켜짐).
- **테이블 등급**: 방마다 입문·일반·고액·VIP 시크릿 등급이 있고 들어갈 때 잔액·레벨·VIP 조건을 본다(숫자는
  `packages/contracts/src/economy.ts`). PvP 방 목록 맨 위의 **빠른 시작**이 자리를 골라 앉혀 주고, **방 만들기**로 개설비를 내고
  공개·비공개(6자리 코드 링크 `/r/<코드>`) 방을 연다. 사람이 없는 채로 10분이 지나면 저절로 닫힌다.
- 홀덤의 바이인·게임 중 칩 보충은 지갑에 있는 무료 코인을 테이블에 옮기는 게임 동작이다. 실제 돈 결제나 계정 충전과 무관하다.

## 기여하기

기여 전에 [CONTRIBUTING.md](CONTRIBUTING.md)를 읽어 주세요. 특히 실제 돈 충전·입금·출금·환전·현금화 기능과 이를 켜는 설정은 받지 않습니다.

## 테스트

```bash
npm run typecheck           # 모든 워크스페이스(+ 통합 테스트 코드)
npm test                    # 단위 테스트(DB 불필요)
npm run test:integration    # 통합 테스트(PostgreSQL 필요) — 약 30~40초
npm run test:load -- --clients 40 --rounds 3   # 부하 테스트 — 약 80초
npm run build -w @opencasino/web
```

**통합 테스트**는 `INTEGRATION_DATABASE_URL`(기본 `postgresql://opencasino:opencasino@127.0.0.1:5432/postgres`)로
접속해 이번 실행 전용 DB(`opencasino_e2_it_<실행id>_*`)를 만들고, 마이그레이션·시드를 한 번 한 템플릿을
파일마다 복제해 쓴 뒤 전부 지운다. 파일마다 API 를 자식 프로세스로 띄워(포트 `INTEGRATION_PORT_BASE`=5205
부터 4개) HTTP 와 socket.io 로만 말을 건다. 라운드 타이머는 실제 값이라 바카라·용호·재시작 테스트는 실제
한 판을 기다린다. API 로그와 junit 결과는 `INTEGRATION_ARTIFACTS_DIR`(기본 OS 임시 폴더의
`opencasino-integration-artifacts`)에 남는다. 알려진 결함은 `it.fails` 로 적어 두었다 — 고쳐지면 그 테스트가
"통과해서 실패"하니 `it` 으로 바꾼다.

**부하 테스트**(`scripts/load/bet-load.mjs`)는 새 DB 를 만들고 API 를 5209 에 띄워, N 명이 한 바카라 방에서
M 라운드 동안 베팅 창이 열리자마자 동시에 베팅한다. ack 지연 p50/p95/p99, 오류, 원장 일관성(항목 합 0,
잔액 합 0, 사용자별 잔액 = 시작 − 베팅 + 지급 + 환불, 방 예치 0)을 출력하고 DB 를 지운다. 옵션은 파일 머리말.

## 마이그레이션 추가하기

스키마는 `apps/api/src/database/migrations/` 의 번호 파일로만 바꾼다. `schema.ts` 는 기준선
`0001_baseline` 으로 동결돼 있다 — 고치면 이미 적용된 DB 에서 체크섬이 달라져 `db:migrate` 가 멈춘다.

1. 다음 번호로 파일을 만든다. 예: `apps/api/src/database/migrations/0002_add_wager_note.ts`

   ```ts
   import type { Migration } from "../migrator.js";

   /** 왜 필요한지 한두 줄. */
   export const migration: Migration = {
     id: "0002_add_wager_note",
     description: "wagers 에 운영 메모 컬럼",
     sql: `ALTER TABLE wagers ADD COLUMN note text;`,
   };
   ```

2. `migrations/index.ts` 목록 끝에 추가한다(빠뜨리면 `migrations.test.ts` 가 실패한다).
3. `npm run db:migrate` → `npm run db:migrate:status` 로 확인하고, `npm run test:integration` 을 돌린다.

규칙:

- 파일마다 자기 트랜잭션에서 돈다. 실패하면 그 파일 전체가 되돌려지고 기록도 남지 않는다.
  `CREATE INDEX CONCURRENTLY` 처럼 트랜잭션 밖에서만 되는 문장은 `transaction: false` 를 주고, 그때는 SQL
  자체를 다시 돌려도 안전하게(`IF NOT EXISTS`) 쓴다.
- **적용된 파일은 고치지 않는다.** 잘못됐으면 다음 번호로 바로잡는다.
- 코드를 이전 버전으로 되돌려도 돌도록 **앞뒤 호환**되게 쓴다: 컬럼 삭제·이름 변경은 "새 컬럼 추가 →
  코드가 둘 다 읽기 → 옛 컬럼 삭제"처럼 배포를 나눠서.
- 여러 프로세스가 동시에 돌려도 `pg_advisory_lock` 으로 한 번에 하나만 적용한다.

## 빌드

- `npm run build -w @opencasino/api` 는 API 를 esbuild 로 묶어 `apps/api/dist/{main,migrate,seed}.js` 를 만든다
  (`@opencasino/*` 가 TS 전용 워크스페이스라 tsc 출력은 node 에서 바로 돌지 않는다 — `scripts/build-api.mjs` 참고).
  `npm run start:dist -w @opencasino/api` 로 번들을 직접 돌려 볼 수 있다.
