/**
 * Every amount on a table is coins, but a bare "100" beside a seat could be a stack, a bet, a
 * hand value or a seat number — so the unit goes on the number rather than being implied by
 * where it sits. One helper so the suffix and the thousands separator never drift apart.
 */
export function coins(amount: number): string {
  return `${amount.toLocaleString()}코인`;
}
