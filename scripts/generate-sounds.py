"""Regenerates SOME of apps/web/public/sounds/*.mp3 via ElevenLabs — only the six keys in
LINES below. Everything else in that folder is off limits to this script, permanently.

┌─────────────────────────────────────────────────────────────────────────────────────┐
│ 절대 다시 만들지 않는 13개 (2026-09-21, "sound add" 커밋 b13f2a1 에서 사장님이         │
│ 직접 다른 사이트로 만들어 온 원본. 이 세션에서 두 번 실수로 덮어썼다가 두 번 다 되돌림): │
│   player  banker  tie  dragon  tiger  win  lose                                       │
│   chip  deal  turn  fold  allin  blackjack                                            │
│ 이 13개 키는 LINES 딕셔너리에 절대 넣지 말 것. 아래 SEALED 에 있으면 즉시 에러.        │
└─────────────────────────────────────────────────────────────────────────────────────┘

나머지도 기본은 **사용자가 TTSMaker(https://ttsmaker.com)에서 직접 만들어 파일로 준다** —
Claude 가 먼저 나서서 이 스크립트를 돌리지 않는다. 이 파일은 "그쪽에서도 안 되겠다"고
확인받았을 때만 쓰는 대체 수단이다.

Requires: ELEVENLABS_API_KEY 환경 변수 (키는 저장소에 두지 않는다)

Run from repo root:
    ELEVENLABS_API_KEY=sk_... python scripts/generate-sounds.py            # LINES 전부
    ELEVENLABS_API_KEY=sk_... python scripts/generate-sounds.py bust push  # 일부만
"""

import json
import os
import pathlib
import sys
import urllib.request

# 위 표와 정확히 같은 13개. 코드로도 한 번 더 막는다 — 주석만 믿지 않는다.
SEALED = {
    "player", "banker", "tie", "dragon", "tiger", "win", "lose",
    "chip", "deal", "turn", "fold", "allin", "blackjack",
}

VOICE_ID = "EXAVITQu4vr4xnSDxMaL"  # Sarah — 무료 등급에서 쓸 수 있는 기본 음성.
MODEL = "eleven_multilingual_v2"
OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "apps" / "web" / "public" / "sounds"

# 지금까지 한 번도 사용자 손을 거치지 않은, 진짜로 비어 있던 자리 6개만 여기 남는다.
LINES = {
    "bust": "Bust",
    "dealerBust": "Dealer Busts",
    "push": "Push.",
    "suitedTie": "Suited Tie",
    "draw": "무승부",
    "redeal": "재경기입니다",
}

assert SEALED.isdisjoint(LINES), "SEALED 키가 LINES 에 들어감 — 원본을 또 덮어쓸 뻔했다"


def synth(key: str, line: str, api_key: str) -> None:
    body = json.dumps({"text": line, "model_id": MODEL}).encode()
    request = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}",
        data=body,
        headers={"xi-api-key": api_key, "Content-Type": "application/json"},
    )
    out = OUT_DIR / f"{key}.mp3"
    out.write_bytes(urllib.request.urlopen(request).read())
    print(f"wrote {out.name}  <- {line}")


def main() -> None:
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        sys.exit("ELEVENLABS_API_KEY 가 없습니다. 키를 환경 변수로 넘겨주세요.")
    wanted = sys.argv[1:] or list(LINES)
    sealed_hit = [key for key in wanted if key in SEALED]
    if sealed_hit:
        sys.exit(f"{', '.join(sealed_hit)} 는 사용자 원본이라 이 스크립트로 못 만든다.")
    unknown = [key for key in wanted if key not in LINES]
    if unknown:
        sys.exit(f"모르는 키: {', '.join(unknown)}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for key in wanted:
        synth(key, LINES[key], api_key)


if __name__ == "__main__":
    main()
