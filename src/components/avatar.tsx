import { cn } from "@/components/ui";

/**
 * Initials avatars. Since the CRM look (2026-11-12, the demo) every avatar is the same quiet circle:
 * the raised color, a 1px line, the initials in the main text color (600). The tint helpers below
 * (toneFor, teamTones) still exist for callers that pass a tone; the circle no longer shows it.
 */
const TONES = [
  "bg-amber-100 text-amber-800",
  "bg-purple-100 text-purple-800",
  "bg-blue-100 text-blue-800",
  "bg-green-100 text-green-800",
  "bg-red-100 text-red-800",
] as const;

const NEUTRAL = "border border-line-2 bg-surface-2 text-fg";

/** "AK" from "Anersi Koka", "MA" from "Madonna". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** "Alex A." from "Alex Alekseyev"; a one-word name stays as it is. */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words[0] ?? name;
  return `${words[0]} ${words[words.length - 1][0].toUpperCase()}.`;
}

/** The first name only ("Alex"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** A tint from any key (a hash): the same key always gets the same tint. */
export function toneFor(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return TONES[h % TONES.length];
}

/**
 * One tint per team member, in name order, so a small team never shares a tint. Only active
 * people take a place in that order; a removed person gets the tint from their id.
 */
export function teamTones(people: Array<{ id: string; name: string; active?: boolean }>): Record<string, string> {
  const current = people.filter((p) => p.active !== false);
  const sorted = [...current].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const tones: Record<string, string> = Object.fromEntries(people.filter((p) => p.active === false).map((p) => [p.id, toneFor(p.id)]));
  sorted.forEach((p, i) => {
    tones[p.id] = TONES[i % TONES.length];
  });
  return tones;
}

export function Avatar({
  name,
  toneKey,
  tone,
  size = 40,
  neutral = false,
  className,
}: {
  name: string;
  /** Usually the person's id; leave out with `neutral` for a gray circle. */
  toneKey?: string;
  /** A tint picked by `teamTones`; wins over `toneKey`. */
  tone?: string;
  size?: number;
  neutral?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-toned={!neutral && Boolean(tone || toneKey) ? "" : undefined}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-[0.02em]", NEUTRAL, className)}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }}
    >
      {initials(name)}
    </span>
  );
}
