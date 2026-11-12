/**
 * The sound the TV plays when a sale lands (owner, 2026-11-04: "sound effects to the app when a sale
 * is made ... somewhat humorous and fun"). The four files are the owner's own, leveled to the same
 * loudness and kept short; "off" plays nothing. Picked in Settings > Sale sound, with a play button on
 * each; rides the board feed so the TV picks a change up within a poll. Browser-safe.
 */
export type SoundKey = "off" | "register" | "air-horn" | "guitar-riff" | "upbeat-intro";

export interface SoundChoice {
  key: Exclude<SoundKey, "off">;
  label: string;
  /** A few words under the name. */
  note: string;
  file: string;
}

export const SOUNDS: SoundChoice[] = [
  { key: "register", label: "Cash register", note: "ka-ching, 3 seconds", file: "/sounds/register.mp3" },
  { key: "air-horn", label: "Air horn", note: "the stadium one, 2 seconds", file: "/sounds/air-horn.mp3" },
  { key: "guitar-riff", label: "Guitar riff", note: "one riff, 2 seconds", file: "/sounds/guitar-riff.mp3" },
  { key: "upbeat-intro", label: "Upbeat intro", note: "a few seconds of music", file: "/sounds/upbeat-intro.mp3" },
];

export const DEFAULT_SOUND: SoundKey = "register";

export function isSoundKey(v: unknown): v is SoundKey {
  return v === "off" || SOUNDS.some((s) => s.key === v);
}

/** The file to play for a key; null for "off". */
export function soundFile(key: SoundKey): string | null {
  return SOUNDS.find((s) => s.key === key)?.file ?? null;
}
