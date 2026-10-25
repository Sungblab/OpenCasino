/**
 * 전부 효과음이 아니라 "말하는" 소리다. 파일은 전부 사용자가 직접 만들어서 넣는다 —
 * 어떤 TTS 엔진으로도 여기 있는 mp3 를 다시 만들지 않는다(음질 때문에 한 번 반려됐고,
 * 재생성은 공들여 만든 원본을 통째로 덮어쓴다). scripts/generate-sounds.py 는 참고용이며
 * 돌리지 않는다. 새 소리가 필요하면 파일명과 문구 목록만 정리해서 사용자에게 준다.
 *
 * 말이 아닌 효과음(칩·딜·카운트다운 등)은 파일이 아니라 이 파일 아래쪽의 Web Audio 합성
 * 함수들(playChip/playCardDeal/playTick/…)이 만든다.
 */
const SOUND_FILES = {
  player: "/sounds/player.mp3",
  banker: "/sounds/banker.mp3",
  tie: "/sounds/tie.mp3",
  dragon: "/sounds/dragon.mp3",
  tiger: "/sounds/tiger.mp3",
  chip: "/sounds/chip.mp3",
  deal: "/sounds/deal.mp3",
  win: "/sounds/win.mp3",
  lose: "/sounds/lose.mp3",
  blackjack: "/sounds/blackjack.mp3",
  turn: "/sounds/turn.mp3",
  fold: "/sounds/fold.mp3",
  allin: "/sounds/allin.mp3",
  // 비어 있던 순간들 — 블랙잭 버스트·딜러 버스트·푸시, 용호의 같은 무늬 타이(50배),
  // 섯다 무승부·재경기. 앞의 넷은 카지노 용어라 영어, 뒤의 둘은 문장이라 한국어다.
  bust: "/sounds/bust.mp3",
  dealerBust: "/sounds/dealerBust.mp3",
  push: "/sounds/push.mp3",
  suitedTie: "/sounds/suitedTie.mp3",
  draw: "/sounds/draw.mp3",
  redeal: "/sounds/redeal.mp3",

  // ── 고스톱 ────────────────────────────────────────────────────────────────
  go: "/sounds/go.mp3",
  stop: "/sounds/stop.mp3",
  go1: "/sounds/go1.mp3",
  go2: "/sounds/go2.mp3",
  go3: "/sounds/go3.mp3",
  ppeok: "/sounds/ppeok.mp3",
  ppeokSweep: "/sounds/ppeokSweep.mp3",
  jappeok: "/sounds/jappeok.mp3",
  ttadak: "/sounds/ttadak.mp3",
  jjok: "/sounds/jjok.mp3",
  ssakssul: "/sounds/ssakssul.mp3",
  shake: "/sounds/shake.mp3",
  bomb: "/sounds/bomb.mp3",
  gwangbak: "/sounds/gwangbak.mp3",
  pibak: "/sounds/pibak.mp3",
  meongbak: "/sounds/meongbak.mp3",
  meongtta: "/sounds/meongtta.mp3",
  gobak: "/sounds/gobak.mp3",
  nagari: "/sounds/nagari.mp3",
  chongtong: "/sounds/chongtong.mp3",
  sellGwang: "/sounds/sellGwang.mp3",
  // 족보가 완성되는 순간(누구든) — 먹은 패의 태그로 판정한다(GostopRoomPage 의 gostopComboSound).
  godori: "/sounds/godori.mp3",
  hongdan: "/sounds/hongdan.mp3",
  cheongdan: "/sounds/cheongdan.mp3",
  chodan: "/sounds/chodan.mp3",
  samgwang: "/sounds/samgwang.mp3",
  bisamgwang: "/sounds/bisamgwang.mp3",
  sagwang: "/sounds/sagwang.mp3",
  ogwang: "/sounds/ogwang.mp3",

  // ── 섯다 족보 ─────────────────────────────────────────────────────────────
  s38Gwangddaeng: "/sounds/s38Gwangddaeng.mp3",
  gwangddaeng: "/sounds/gwangddaeng.mp3",
  jangddaeng: "/sounds/jangddaeng.mp3",
  ddaeng: "/sounds/ddaeng.mp3",
  ali: "/sounds/ali.mp3",
  doksa: "/sounds/doksa.mp3",
  gubbing: "/sounds/gubbing.mp3",
  jangbbing: "/sounds/jangbbing.mp3",
  jangsa: "/sounds/jangsa.mp3",
  seryuk: "/sounds/seryuk.mp3",
  gabo: "/sounds/gabo.mp3",
  mangtong: "/sounds/mangtong.mp3",
  ambassador: "/sounds/ambassador.mp3",
  ddaengCatcher: "/sounds/ddaengCatcher.mp3",
  gusa: "/sounds/gusa.mp3",
  mungu: "/sounds/mungu.mp3",

  // ── 홀덤 ──────────────────────────────────────────────────────────────────
  royalFlush: "/sounds/royalFlush.mp3",
  straightFlush: "/sounds/straightFlush.mp3",
  fourOfAKind: "/sounds/fourOfAKind.mp3",
  fullHouse: "/sounds/fullHouse.mp3",
  flush: "/sounds/flush.mp3",
  straight: "/sounds/straight.mp3",
  threeOfAKind: "/sounds/threeOfAKind.mp3",
  twoPair: "/sounds/twoPair.mp3",
  onePair: "/sounds/onePair.mp3",
  highCard: "/sounds/highCard.mp3",
  check: "/sounds/check.mp3",
  call: "/sounds/call.mp3",
  raise: "/sounds/raise.mp3",

  // ── 블랙잭 · 바카라 ───────────────────────────────────────────────────────
  double: "/sounds/double.mp3",
  split: "/sounds/split.mp3",
  surrender: "/sounds/surrender.mp3",
  insurance: "/sounds/insurance.mp3",
  natural: "/sounds/natural.mp3",

  // ── 룰렛 · 식보 ───────────────────────────────────────────────────────────
  // 효과음 다섯은 Pixabay 로열티 프리 원본을 길이만 맞춘 것, 결과 음성 여섯은 TTSMaker 보민(503).
  // lightning 은 라이트닝 바카라의 번개 카드에도 쓴다.
  ballSpin: "/sounds/ballSpin.mp3",
  ballDrop: "/sounds/ballDrop.mp3",
  lightning: "/sounds/lightning.mp3",
  diceShake: "/sounds/diceShake.mp3",
  diceLand: "/sounds/diceLand.mp3",
  red: "/sounds/red.mp3",
  black: "/sounds/black.mp3",
  zero: "/sounds/zero.mp3",
  small: "/sounds/small.mp3",
  big: "/sounds/big.mp3",
  triple: "/sounds/triple.mp3",

  // ── 슬롯 ─────────
  // BigWin · FsSummary 는 Pixabay 로열티 프리 징글(floraphonic "You Win Sequence" 1·2)에 코인 쏟아짐
  // ("Slot Machine Coin Payout 1")을 섞은 것, 나머지는 ffmpeg 합성(C장조 종소리 — 등급이 오를수록 높고 촘촘하다).
  // ReturnLow 는 일부러 낮고 둔한 "툴" 하나 — 베팅 이하 당첨을 승리처럼 들리게 하지 않는다(문서 A14/D).
  slotSpinStart: "/sounds/slotSpinStart.mp3",
  slotReelStop: "/sounds/slotReelStop.mp3",
  slotAnticipation: "/sounds/slotAnticipation.mp3",
  slotReturnLow: "/sounds/slotReturnLow.mp3",
  slotWinSmall: "/sounds/slotWinSmall.mp3",
  slotWinMedium: "/sounds/slotWinMedium.mp3",
  slotBigWin: "/sounds/slotBigWin.mp3",
  slotMegaWin: "/sounds/slotMegaWin.mp3",
  slotEpicWin: "/sounds/slotEpicWin.mp3",
  slotFsTrigger: "/sounds/slotFsTrigger.mp3",
  slotFsIntro: "/sounds/slotFsIntro.mp3",
  slotFsRetrigger: "/sounds/slotFsRetrigger.mp3",
  slotFsSummary: "/sounds/slotFsSummary.mp3",
} as const;

export type SoundName = keyof typeof SOUND_FILES;

const MUTE_KEY = "opencasino.muted";
const cache = new Map<SoundName, HTMLAudioElement>();
let muted = typeof window !== "undefined" && window.localStorage.getItem(MUTE_KEY) === "1";

/* ── 볼륨 ─────────────────────────────────────────────────────────────────────
   슬라이더(프로필 메뉴) 하나는 효과음(파일·합성 전부), 하나는 배경 음악. 0~1 로 저장하고, **기본 위치가 예전 고정 크기와
   같다** — 효과음은 0.7 일 때 지금 소리 그대로(파일 0.55·합성 각자 상수), 올리면 그 위로 1.43배까지. 배경 음악은 0.4 가
   BGM_LEVEL 그대로, 끝까지 올리면 2.5배. 처음 쓰는 사람은 아무것도 안 만져도 이전과 똑같이 들린다. */
const SFX_VOLUME_KEY = "opencasino.sfxVolume";
const BGM_VOLUME_KEY = "opencasino.bgmVolume";
export const SFX_VOLUME_DEFAULT = 0.7;
export const BGM_VOLUME_DEFAULT = 0.4;

function readVolume(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
  } catch {
    return fallback;
  }
}
let sfxVolume = typeof window !== "undefined" ? readVolume(SFX_VOLUME_KEY, SFX_VOLUME_DEFAULT) : SFX_VOLUME_DEFAULT;
let bgmVolume = typeof window !== "undefined" ? readVolume(BGM_VOLUME_KEY, BGM_VOLUME_DEFAULT) : BGM_VOLUME_DEFAULT;

/** 효과음 배율 — 기본 위치가 1배. */
const sfxScale = () => sfxVolume / SFX_VOLUME_DEFAULT;
/** 합성음 한 번의 크기. 0 으로 두면 exponentialRamp 가 던지니 바닥을 둔다. */
const amp = (base: number) => Math.max(0.0001, base * sfxScale());
/** 효과음을 내지 않아도 되는 상태(전체 끄기 · 효과음 0). */
const quiet = () => muted || sfxVolume <= 0;
/** 파일 효과음 요소의 볼륨(HTMLAudioElement 는 1 이 상한). */
const fileVolume = () => Math.min(1, 0.55 * sfxScale());

function audioFor(name: SoundName): HTMLAudioElement {
  let audio = cache.get(name);
  if (!audio) {
    audio = new Audio(SOUND_FILES[name]);
    audio.volume = fileVolume();
    audio.preload = "auto";
    cache.set(name, audio);
  }
  return audio;
}

/**
 * Warms every effect's Audio element (and its network fetch) before it's ever played, so the
 * first bust/win/fold in a game isn't the one paying the download cost. Safe to call before any
 * user gesture — this only starts a fetch, it never calls .play().
 */
export function preloadSounds(names: readonly SoundName[] = Object.keys(SOUND_FILES) as SoundName[]): void {
  for (const name of names) audioFor(name);
}

/**
 * 게임별로 필요한 소리만 미리 받는다. 예전에는 로그인 화면에서도 74개 전부를 받았다.
 * 앱이 뜰 때는 COMMON 만, 방에 들어가면 그 게임 묶음을 받는다.
 */
export const COMMON_SOUNDS: readonly SoundName[] = ["chip", "deal", "win", "lose", "turn", "draw"];
export const GAME_SOUNDS = {
  baccarat: ["player", "banker", "tie", "natural", "lightning"],
  dragonTiger: ["dragon", "tiger", "tie", "suitedTie"],
  blackjack: ["blackjack", "bust", "dealerBust", "push", "double", "split", "surrender", "insurance", "lightning"],
  holdem: ["fold", "allin", "check", "call", "raise", "royalFlush", "straightFlush", "fourOfAKind", "fullHouse", "flush", "straight", "threeOfAKind", "twoPair", "onePair", "highCard"],
  badugi: ["fold", "allin", "check", "call", "raise"],
  sutda: ["fold", "allin", "check", "call", "redeal", "s38Gwangddaeng", "gwangddaeng", "jangddaeng", "ddaeng", "ali", "doksa", "gubbing", "jangbbing", "jangsa", "seryuk", "gabo", "mangtong", "ambassador", "ddaengCatcher", "gusa", "mungu"],
  gostop: ["go", "stop", "go1", "go2", "go3", "ppeok", "ppeokSweep", "jappeok", "ttadak", "jjok", "ssakssul", "shake", "bomb", "gwangbak", "pibak", "meongbak", "meongtta", "gobak", "nagari", "chongtong", "sellGwang", "godori", "hongdan", "cheongdan", "chodan", "samgwang", "bisamgwang", "sagwang", "ogwang"],
  roulette: ["ballSpin", "ballDrop", "lightning", "red", "black", "zero"],
  sicBo: ["diceShake", "diceLand", "lightning", "small", "big", "triple"],
  // 머니 휠: 전용 녹음이 없어 슬롯 소리를 빌린다 — 회전 시작·멈춤 딸깍·배수 칸 팡파르.
  moneyWheel: ["slotSpinStart", "slotReelStop", "slotFsTrigger"],
  slot: ["slotSpinStart", "slotReelStop", "slotAnticipation", "slotReturnLow", "slotWinSmall", "slotWinMedium", "slotBigWin", "slotMegaWin", "slotEpicWin", "slotFsTrigger", "slotFsIntro", "slotFsRetrigger", "slotFsSummary"],
} as const satisfies Record<string, readonly SoundName[]>;

/** Plays a sound effect. Silently no-ops when muted or blocked by the browser's autoplay policy. */
export function playSound(name: SoundName): void {
  if (quiet()) return;
  try {
    const audio = audioFor(name);
    audio.volume = fileVolume();
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  } catch {
    // Missing asset or unsupported format: never let audio break gameplay.
  }
}

export function getSfxVolume(): number {
  return sfxVolume;
}

/** 효과음 크기(0~1). 이미 받아 둔 파일 요소에도 바로 적용한다. */
export function setSfxVolume(next: number): void {
  sfxVolume = Math.min(1, Math.max(0, next));
  try { window.localStorage.setItem(SFX_VOLUME_KEY, String(sfxVolume)); } catch { /* 저장 실패는 이번 방문에만 적용 */ }
  for (const audio of cache.values()) audio.volume = fileVolume();
}

export function isSoundMuted(): boolean {
  return muted;
}

export function setSoundMuted(next: boolean): void {
  muted = next;
  window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  syncBgm();
}

/**
 * 카드 한 장이 미끄러지는 소리. 파일이 아니라 그 자리에서 합성한다 — 이 게임의 사운드는 전부
 * 한국어 TTS 안내 음성이라(scripts/generate-sounds.py) 카드 효과음이 아예 없었고, 배분이
 * 눈에만 보이고 귀에는 아무것도 없었다. 짧은 노이즈를 대역 통과로 깎으면 패가 스치는 소리가
 * 되고, 에셋을 하나도 늘리지 않는다.
 *
 * ponytail: 합성이라 톤 조절이 상수 몇 개다. 진짜 녹음이 필요해지면 그때 파일로 바꾼다.
 */
let audioContext: AudioContext | null = null;

function contextFor(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  audioContext ??= new Ctor();
  // 첫 사용자 조작 전에는 정지 상태로 만들어진다. 깨워 두되 실패해도 게임에는 영향이 없다.
  if (audioContext.state === "suspended") void audioContext.resume().catch(() => undefined);
  return audioContext;
}

/**
 * iOS 사파리는 사용자 조작 안에서만 오디오를 깨운다. 합성 효과음(칩·딜·틱)은 컨텍스트가
 * 깨어 있지 않으면 조용히 버려져서 첫 칩 소리가 늘 빠졌다. 모든 터치·키 입력에서 한 번씩
 * 깨워 둔다(이미 깨어 있으면 아무 일도 하지 않는다).
 */
export function installAudioUnlock(): void {
  if (typeof window === "undefined") return;
  const unlock = () => { contextFor(); };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}

export function playCardDeal(): void {
  if (quiet()) return;
  try {
    const ctx = contextFor();
    if (!ctx || ctx.state !== "running") return;
    const duration = 0.085;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) {
      // 뒤로 갈수록 빠르게 잦아드는 노이즈 — 카드가 닿고 미끄러지는 모양.
      const fade = (1 - i / frames) ** 3;
      samples[i] = (Math.random() * 2 - 1) * fade;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2100;
    band.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = amp(0.16);
    source.connect(band).connect(gain).connect(ctx.destination);
    source.start();
  } catch {
    // 오디오는 있으면 좋은 것이지 게임을 막을 이유가 못 된다.
  }
}

/**
 * 칩이 판 위에 놓이는 소리 — 체크·콜·베팅·레이즈·삥·따당·쿼터·하프처럼 판마다 여러 번
 * 나는 액션에 쓴다. 이 자리에 원래 TTS "베팅을 시작하겠습니다"가 있었는데, 바카라는 베팅
 * 창이 한 번 열리고 닫히는 게임이라 맞는 말이었지만 홀덤·섯다는 매 액션마다 같은 안내를
 * 반복하는 꼴이었다. 합성 소리라 반복돼도 안내 방송처럼 들리지 않는다.
 */
export function playChip(): void {
  if (quiet()) return;
  try {
    const ctx = contextFor();
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    // 짧은 노이즈 클릭 두 번 — 칩 두어 개가 겹쳐 놓이는 느낌.
    for (const offset of [0, 0.022]) {
      const duration = 0.035;
      const frames = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < frames; i += 1) samples[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 950;
      const gain = ctx.createGain();
      gain.gain.value = amp(0.14);
      source.connect(low).connect(gain).connect(ctx.destination);
      source.start(now + offset);
    }
  } catch {
    // 합성 실패는 게임에 영향 없음.
  }
}

/** 다이 — 패를 접어 내려놓듯 낮게 가라앉는 소리. 섯다 전용(홀덤은 기존 폴드 음성을 그대로 쓴다). */
export function playFold(): void {
  if (quiet()) return;
  try {
    const ctx = contextFor();
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(85, now + 0.18);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(amp(0.13), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.22);
  } catch {
    // 합성 실패는 게임에 영향 없음.
  }
}

/**
 * 정산 때 칩 더미가 날아가는 소리(tableFx.flyAway 와 같은 순간). 이긴 칩이 잔액으로 올 때는
 * 칩이 차례로 쌓이듯 높아지는 딸깍 여섯 번, 진 칩을 걷어 갈 때는 낮게 끌리는 세 번.
 * 판마다 한 번만 부른다 — 영역마다 부르면 겹쳐서 뭉개진다.
 */
export function playChipSweep(won: boolean): void {
  if (quiet()) return;
  try {
    const ctx = contextFor();
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const count = won ? 6 : 3;
    for (let n = 0; n < count; n += 1) {
      const duration = won ? 0.03 : 0.06;
      const frames = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < frames; i += 1) samples[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const band = ctx.createBiquadFilter();
      band.type = won ? "bandpass" : "lowpass";
      band.frequency.value = won ? 1400 + n * 260 : 700;
      band.Q.value = won ? 1.4 : 0.7;
      const gain = ctx.createGain();
      gain.gain.value = amp(won ? 0.15 : 0.1);
      source.connect(band).connect(gain).connect(ctx.destination);
      source.start(now + n * (won ? 0.055 : 0.08));
    }
  } catch {
    // 합성 실패는 게임에 영향 없음.
  }
}

/** 올인 — 칩을 한꺼번에 쏟아붓는 소리. playChip() 의 짧은 클릭을 다섯 번 겹친다. */
export function playAllInChips(): void {
  if (quiet()) return;
  try {
    const ctx = contextFor();
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    for (let n = 0; n < 5; n += 1) {
      const duration = 0.04;
      const frames = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < frames; i += 1) samples[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 900;
      const gain = ctx.createGain();
      gain.gain.value = amp(0.12);
      source.connect(low).connect(gain).connect(ctx.destination);
      source.start(now + n * 0.05);
    }
  } catch {
    // 합성 실패는 게임에 영향 없음.
  }
}

/** 패가 실제로 열리는 순간 — 쪼기(섯다) 끝에 카드가 뒤집히는 짧은 반짝임. 두 음을 살짝
 *  겹쳐 올린다. 이 게임에서 제일 긴장되는 개인적인 순간인데 지금까지 아무 소리가 없었다. */
export function playReveal(): void {
  if (quiet()) return;
  try {
    const ctx = contextFor();
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    for (const [freq, delay] of [[520, 0], [780, 0.05]] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + delay);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(amp(0.13), now + delay + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.34);
    }
  } catch {
    // 합성 실패는 게임에 영향 없음.
  }
}

/** 카드 한 장을 고르는(공개할 패 · 쇼다운에 쓸 두 장) 짧고 밝은 클릭 — playChip() 의 낮은
 *  이중 딸깍과는 다른 소리라야 "돈을 건다"와 "패를 고른다"가 손끝에서 구분된다. */
export function playSelect(): void {
  if (quiet()) return;
  try {
    const ctx = contextFor();
    if (!ctx || ctx.state !== "running") return;
    const duration = 0.03;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) samples[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 2600;
    const gain = ctx.createGain();
    gain.gain.value = amp(0.12);
    source.connect(high).connect(gain).connect(ctx.destination);
    source.start();
  } catch {
    // 합성 실패는 게임에 영향 없음.
  }
}

/**
 * 내 차례(또는 3장 초이스 선택 창)가 3초 이하로 남았을 때 매초 한 번 울리는 긴장 신호음.
 * seconds가 낮을수록 음이 높아진다 — 숫자에서 눈을 떼도 얼마 안 남았다는 게 들린다.
 */
export function playTick(secondsLeft: number): void {
  if (quiet()) return;
  try {
    const ctx = contextFor();
    if (!ctx || ctx.state !== "running") return;
    const clamped = Math.max(1, Math.min(3, secondsLeft));
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 520 + (3 - clamped) * 160;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(amp(0.16), now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.11);
  } catch {
    // 합성 실패는 게임에 영향 없음.
  }
}

/** 구슬이 못에 닿는 소리. 줄이 내려갈수록 음이 올라가 낙하가 귀로 들린다. 여러 알이 한꺼번에 떨어져도 시끄럽지 않게 아주 작고, 25ms 안에는 다시 울리지 않는다. */
let lastPegTickAt = 0;
export function playPegTick(row: number): void {
  if (quiet()) return;
  const stamp = typeof performance !== "undefined" ? performance.now() : 0;
  if (stamp - lastPegTickAt < 25) return;
  lastPegTickAt = stamp;
  try {
    const ctx = contextFor();
    if (!ctx || ctx.state !== "running") return;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 620 + Math.max(0, Math.min(12, row)) * 46;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(amp(0.045), now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  } catch {
    // 합성 실패는 게임에 영향 없음.
  }
}

/* ── 배경 음악 ─────────────────────────────────────────────────────────────────
   테이블 게임(바카라·블랙잭·룰렛…)은 잔잔한 재즈 피아노, 슬롯·머니 휠·크래시는 가벼운 펑크. 파일은 로열티 프리
   (Pixabay Content License — 저작자 표시 의무 없음) 원곡이며 출처는 public/sounds/bgm/SOURCES.md 에 있다.
   효과음·음성을 덮지 않게 작게(BGM_LEVEL) 깔고, 볼륨은 Web Audio 게인으로 다룬다 — iOS 사파리는 audio.volume 을
   무시해서 요소 볼륨으로는 원래 크기 그대로 나온다. 전체 소리 끄기(muted)와 별도로 배경 음악만 끌 수 있다. */

export type BgmTrack = "lounge" | "groove";
/** 곡 묶음마다 여러 곡을 돌아가며 튼다 — 2분짜리 한 곡만 돌리면 금방 귀에 걸린다. */
const BGM_FILES: Record<BgmTrack, readonly string[]> = {
  lounge: ["/sounds/bgm/lounge-1.mp3", "/sounds/bgm/lounge-2.mp3", "/sounds/bgm/lounge-3.mp3", "/sounds/bgm/lounge-4.mp3"],
  groove: ["/sounds/bgm/groove-1.mp3", "/sounds/bgm/groove-2.mp3", "/sounds/bgm/groove-3.mp3", "/sounds/bgm/groove-4.mp3"],
};
const BGM_KEY = "opencasino.bgm";
const BGM_LEVEL = 0.2;
/** 지금 슬라이더 위치에서의 배경 음악 게인. */
const bgmLevel = () => BGM_LEVEL * (bgmVolume / BGM_VOLUME_DEFAULT);
const BGM_FADE_IN_S = 1.6;
const BGM_FADE_OUT_S = 0.6;

let bgmOff = typeof window !== "undefined" && window.localStorage.getItem(BGM_KEY) === "0";
/** 지금 화면이 원하는 곡(방 안이면 그 게임의 곡, 밖이면 null). 꺼져 있어도 기억해 두어 다시 켜면 이어진다. */
let bgmWanted: BgmTrack | null = null;
let bgmNow: { track: BgmTrack; audio: HTMLAudioElement; gain: GainNode | null } | null = null;

/** 게임 종류 → 곡. 판이 빠르게 돌고 화면이 번쩍이는 게임은 그루브, 나머지 테이블은 라운지. */
export function bgmForGame(gameType: string): BgmTrack {
  return gameType === "slot" || gameType === "pachinko" || gameType === "money_wheel" || gameType === "crash" ? "groove" : "lounge";
}

function fade(target: { audio: HTMLAudioElement; gain: GainNode | null }, to: number, seconds: number): void {
  const ctx = target.gain?.context;
  if (target.gain && ctx) {
    const now = ctx.currentTime;
    target.gain.gain.cancelScheduledValues(now);
    target.gain.gain.setValueAtTime(target.gain.gain.value, now);
    target.gain.gain.linearRampToValueAtTime(to, now + seconds);
  } else {
    target.audio.volume = to;
  }
}

function startBgm(track: BgmTrack): void {
  const list = BGM_FILES[track];
  let index = Math.floor(Math.random() * list.length);
  const audio = new Audio(list[index]);
  audio.preload = "auto";
  // 한 곡이 끝나면 다음 곡으로(같은 요소·같은 게인을 그대로 써서 볼륨이 튀지 않는다).
  audio.addEventListener("ended", () => {
    index = (index + 1) % list.length;
    audio.src = list[index]!;
    void audio.play().catch(() => undefined);
  });
  let gain: GainNode | null = null;
  const ctx = contextFor();
  if (ctx) {
    try {
      gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination);
    } catch {
      gain = null;
    }
  }
  if (!gain) audio.volume = 0;
  const current = { track, audio, gain };
  bgmNow = current;
  const begin = () => {
    if (bgmNow !== current) return;
    void audio.play().then(() => fade(current, bgmLevel(), BGM_FADE_IN_S), () => {
      // 첫 조작 전엔 자동 재생이 막힌다 — 첫 터치·클릭에 다시 시도한다(그때 오디오 컨텍스트도 깨어난다).
      window.addEventListener("pointerdown", begin, { once: true });
    });
  };
  begin();
}

function stopBgmNow(): void {
  const current = bgmNow;
  if (!current) return;
  bgmNow = null;
  fade(current, 0, BGM_FADE_OUT_S);
  window.setTimeout(() => { current.audio.pause(); current.audio.src = ""; }, BGM_FADE_OUT_S * 1000 + 50);
}

/** 원하는 곡과 켜짐 상태·탭 보임에 맞춰 실제 재생을 맞춘다. */
function syncBgm(): void {
  if (typeof window === "undefined") return;
  const want = !muted && !bgmOff && document.visibilityState !== "hidden" ? bgmWanted : null;
  if (bgmNow?.track === want) return;
  stopBgmNow();
  if (want) startBgm(want);
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", syncBgm);

/** 방에 들어와 화면이 다 떴을 때 부른다. 같은 곡이면 이어서 튼다. */
export function playBgm(track: BgmTrack): void {
  bgmWanted = track;
  syncBgm();
}

/** 방을 나갈 때. */
export function stopBgm(): void {
  bgmWanted = null;
  syncBgm();
}

export function getBgmVolume(): number {
  return bgmVolume;
}

/** 배경 음악 크기(0~1). 틀어 둔 곡에도 바로 적용한다. */
export function setBgmVolume(next: number): void {
  bgmVolume = Math.min(1, Math.max(0, next));
  try { window.localStorage.setItem(BGM_VOLUME_KEY, String(bgmVolume)); } catch { /* 저장 실패는 이번 방문에만 적용 */ }
  if (bgmNow) fade(bgmNow, bgmLevel(), 0.08);
}

export function isBgmOn(): boolean {
  return !bgmOff;
}

export function setBgmOn(on: boolean): void {
  bgmOff = !on;
  window.localStorage.setItem(BGM_KEY, on ? "1" : "0");
  syncBgm();
}
