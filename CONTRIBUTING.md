# 기여 안내

OpenCasino는 무료 플레이머니 전용 프로젝트입니다. 코인은 게임에서만 쓰이며 현금 가치가 없습니다.

## 반드시 지킬 경제 정책

다음 기능이나 설정을 추가하지 마세요.

- 실제 돈 결제, 코인 구매, 충전 또는 입금
- 출금, 환전, 현금화, 상품권·현금성 보상
- 외부 결제·송금·금융 서비스 연동
- 위 기능을 켜는 환경 변수나 관리자 우회 기능

무료 코인을 지급하거나 테이블 사이에서 게임용 칩을 옮기는 기능은 실제 결제와 분리되어야 합니다. 현재 서버는 `PLAY_MONEY_MODE=0` 환경변수를 무시하고 플레이머니 모드로 고정되어 있습니다. 지갑 입금·출금 요청과 관리자 승인은 지원하지 않습니다.

이 정책에 어긋나는 변경은 기능 구현, 문서, 테스트 어느 형태로도 병합하지 않습니다.

## Economic policy in English

This project is play-money only. Do not add real-money payments, coin purchases, deposits, withdrawals, cash-outs, redemption, or integrations that enable them. Do not add an environment switch or admin override for these features. Coins have no monetary value. Contributions that violate this rule will not be merged.

## 개발 및 확인

```bash
npm ci
cp .env.example .env
npm run db:up
npm run db:migrate
npm run check
```

통합 테스트와 운영 빌드 절차는 [README.md](README.md)를 참고하세요. 비밀값, 운영 데이터, 로컬 `.env` 파일은 커밋에 포함하지 마세요.
