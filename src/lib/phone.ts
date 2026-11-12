/**
 * Cell numbers, the name a person signs in with (owner, 2026-11-12). Pure and browser-safe.
 * Stored one way only, "+1XXXXXXXXXX" for US numbers, so "(248) 555-0100", "248.555.0100" and
 * "1 248 555 0100" are the same sign-in. A number never reaches a browser that is not a manager's.
 */

/** A typed number in stored form, or null when it is not a phone number. */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 40) return null;
  // Only what people type in a phone number: digits, spaces, dots, dashes, brackets, one leading plus.
  if (!/^\+?[\d\s().\-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) {
    // Already international. A +1 number must still be a whole US number.
    if (digits.startsWith("1")) return digits.length === 11 && usOk(digits.slice(1)) ? `+${digits}` : null;
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== "0" ? `+${digits}` : null;
  }
  if (digits.length === 10 && usOk(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1" && usOk(digits.slice(1))) return `+${digits}`;
  return null;
}

/** Ten US digits: the area code and the exchange never start with 0 or 1. */
function usOk(ten: string): boolean {
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten);
}

/** A stored number as people read it: "(248) 555-0100" for a US number, the number itself otherwise. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : e164;
}
