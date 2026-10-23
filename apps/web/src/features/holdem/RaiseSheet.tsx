import type { ReactNode } from "react";
import { PhaseSeconds } from "../pvp/phaseClock";

export interface RaisePreset { key: string; label: string; hint: string; value: number }

/**
 * 레이즈 금액 창 — 독 자리에서 위로 자란다(섯다·맞고의 고르는 창과 같은 틀). 예전엔 프리셋·스테퍼가 독 안에
 * 늘 붙어 있어서 내 차례마다 독이 커졌다 줄며 판 전체가 100px 가까이 흔들렸다. 이제 독은 버튼 한 줄이고,
 * "레이즈"를 누를 때만 이 창이 뜬다. 프리셋은 한 번 누르면 바로 그 금액으로 보낸다.
 * 바이인·칩 충전 창도 같은 틀이다(verb·note 만 바꾼다).
 */
export function RaiseSheet({ opening, verb: verbOverride, note, value, min, max, step, presets, onStep, onPreset, onConfirm, onCancel }: {
  opening: boolean;
  verb?: string;
  note?: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  presets: RaisePreset[];
  onStep: (delta: number) => void;
  onPreset: (preset: RaisePreset) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const verb = verbOverride ?? (opening ? "베팅" : "레이즈");
  return (
    <section className="hv6-sheet" aria-label={`${verb} 금액`}>
      <header>
        <strong>{verb} 금액</strong>
        <small>{note ?? <><PhaseSeconds />초 · 버튼을 누르면 바로 {verb}해요</>}</small>
        <button type="button" className="hv6-sheet-close" onClick={onCancel} aria-label="닫기">×</button>
      </header>
      <div className="hv6-presets">
        {presets.map((preset) => (
          <button key={preset.key} type="button" className="hv6-preset" title={preset.hint} onClick={() => onPreset(preset)}>
            <span>{preset.label}</span>
            <b>{preset.value.toLocaleString()}코인</b>
          </button>
        ))}
      </div>
      <div className="hv6-raise-row">
        <button type="button" className="hv6-step" disabled={value <= min} onClick={() => onStep(-step)} aria-label="금액 줄이기">−</button>
        <input
          type="range"
          className="hv6-range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onStep(Number(event.target.value) - value)}
          aria-label={`${verb} 금액`}
        />
        <button type="button" className="hv6-step" disabled={value >= max} onClick={() => onStep(step)} aria-label="금액 늘리기">＋</button>
        <button type="button" className="hv6-confirm" onClick={onConfirm}>{verb} <b>{value.toLocaleString()}코인</b></button>
      </div>
    </section>
  );
}

/**
 * 폰 레이즈 패드 — 독 위 오른쪽에 뜬다. 독 자리를 덮는 창은 폰에서 내 홀카드를 가렸고(레이즈 크기는 내 패를
 * 보며 정한다), 독 높이(50)에 묶여 잘렸다. 프리셋은 누르면 바로, 미세 조정은 −/＋, 확인은 가운데 큰 버튼.
 * 슬라이더는 뺐다(폰에선 손가락으로 맞추기 어렵다). 누르는 곳은 전부 44px 이상.
 */
export function RaisePad({ opening, verb: verbOverride, value, min, max, step, presets, onStep, onPreset, onConfirm, onCancel }: {
  opening: boolean;
  verb?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  presets: RaisePreset[];
  onStep: (delta: number) => void;
  onPreset: (preset: RaisePreset) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const verb = verbOverride ?? (opening ? "베팅" : "레이즈");
  return (
    <section className="hv6-pad" aria-label={`${verb} 금액`}>
      <div className="hv6-pad-presets">
        {presets.map((preset) => (
          <button key={preset.key} type="button" className="hv6-preset" title={preset.hint} onClick={() => onPreset(preset)}>
            <span>{preset.label}</span>
            <b>{preset.value.toLocaleString()}코인</b>
          </button>
        ))}
        <button type="button" className="hv6-pad-close" onClick={onCancel} aria-label="닫기">닫기</button>
      </div>
      <div className="hv6-pad-row">
        <button type="button" className="hv6-step" disabled={value <= min} onClick={() => onStep(-step)} aria-label="금액 줄이기">−</button>
        <button type="button" className="hv6-confirm" onClick={onConfirm}>{verb} <b>{value.toLocaleString()}코인</b></button>
        <button type="button" className="hv6-step" disabled={value >= max} onClick={() => onStep(step)} aria-label="금액 늘리기">＋</button>
      </div>
    </section>
  );
}
