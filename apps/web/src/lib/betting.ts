const CHIP_CANDIDATES = [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000] as const;
/** 칩 줄 한 칸에 놓는 최대 개수. 넘으면 최소 칩 바로 위의 작은 칩부터 뺀다(큰 판돈 방은 큰 칩을 쓴다). */
const MAX_CHIPS = 7;

/**
 * Chip face colours, one per denomination tier. These are the single source of truth:
 * the CSS mirrors them as --chip-0…--chip-4 for the tray/stack/picker, and the flying-chip
 * animation reads them from here. Keep the two in sync — a chip that changes colour
 * mid-flight is the tell that they drifted apart.
 */
export const CHIP_TIER_COLORS = ["#6e6e6e", "#a41600", "#038c20", "#141414", "#6b398d"] as const;

/**
 * The lighter edge-spot colour printed around each tier's rim, mirroring --chip-N-rim.
 * These are literals rather than a color-mix() of the face because a custom property holding
 * an unsupported function parses fine and only fails once it is substituted into the chip's
 * `background`, which silently drops the whole disc and leaves just the amount label.
 */
export const CHIP_TIER_RIM_COLORS = ["#f2f2f2", "#f2f2f2", "#f2f2f2", "#f2f2f2", "#f2f2f2"] as const;

/** Lowest denomination each tier starts at, used to colour an arbitrary bet total. */
const CHIP_TIER_FLOORS = [1, 5, 10, 50, 100] as const;

/** Tier index for an arbitrary amount (a settled bet total, not a tray denomination). */
function chipTierForAmount(amount: number): number {
  let tier = 0;
  CHIP_TIER_FLOORS.forEach((floor, index) => {
    if (amount >= floor) tier = index;
  });
  return tier;
}

/** Tier face colour for an arbitrary amount. */
export function chipColorForAmount(amount: number): string {
  return CHIP_TIER_COLORS[chipTierForAmount(amount)]!;
}

/** Tier rim colour for an arbitrary amount, paired with chipColorForAmount. */
export function chipRimForAmount(amount: number): string {
  return CHIP_TIER_RIM_COLORS[chipTierForAmount(amount)]!;
}

/** Chip denominations tailored to a room, always including its exact limits. */
export function chipValuesForRoom(minBet: number, maxBet: number): number[] {
  const values = [...new Set([minBet, ...CHIP_CANDIDATES.filter((value) => value >= minBet && value <= maxBet), maxBet])]
    .sort((a, b) => a - b);
  while (values.length > MAX_CHIPS) values.splice(1, 1);
  return values;
}

export function chipTier(value: number): number {
  if (value < 5) return 0;
  if (value < 10) return 1;
  if (value < 50) return 2;
  if (value < 100) return 3;
  return 4;
}

/** Maximum legal next click, capped by both wallet and the room's round limit. */
export function maximumAdditionalBet(wallet: number, currentBet: number, maxBet: number): number {
  return Math.max(0, Math.min(Math.floor(wallet), maxBet - currentBet));
}

/**
 * Same as maximumAdditionalBet, but for a lightning table where the chip you tap is the
 * total you pay, not the stake — the fee comes out of it (splitLightningTotal, game-core).
 * The wallet ceiling applies to that total directly (nothing to halve any more); the
 * remaining-room ceiling is still in stake terms (maxBet caps stake at risk, same as any
 * other table), converted back to a total via the same ratio the server will split by.
 */
export function maximumAdditionalLightningBet(wallet: number, currentStake: number, maxBet: number, feePercent: 0 | 20 | 100): number {
  const stakeRoom = Math.max(0, maxBet - currentStake);
  const totalRoom = feePercent === 0 ? stakeRoom : Math.floor((stakeRoom * (100 + feePercent)) / 100);
  return Math.max(0, Math.min(Math.floor(wallet), totalRoom));
}
