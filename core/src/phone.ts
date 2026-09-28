// Copied from the billing app (shridhar project/shared/src/phone.ts) so the two repos never depend
// on each other. The billing app is the original: if its search rules change, copy them here.

/**
 * One canonical form for a phone number, used by the browser and the server alike.
 *
 * A shop enters the same regular as "9886012345" one week and "+91 98860 12345" the next. Keeping
 * only the digits is not enough: those two differ by the country code, so they became two
 * customers with the khata split between them. Folding the Indian country code and the old trunk
 * zero away makes them one person.
 *
 * The trade-off is deliberate: a 12-digit foreign number that happens to start 91 would be folded
 * too. For a kirana shop in Karnataka that is the right way round.
 */
export function normalisePhone(raw: string): string {
  let digits = String(raw ?? '').replace(/\D/g, '');
  // "00" is the international prefix, and only when something follows it that looks like a
  // country code. Stripping it unconditionally turned ten zeros into eight and called the result
  // a phone number.
  if (digits.startsWith('00') && digits.length >= 12) digits = digits.slice(2); // 0091 98860 12345
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1); // 0 98860 12345
  return digits;
}
