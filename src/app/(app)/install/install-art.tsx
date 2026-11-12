import type { ReactNode } from "react";
import { ScoreMark } from "@/components/brand";
import { cn } from "@/components/ui";

/**
 * The drawn pictures for the phone guide: the button to tap, as it looks on the phone. Line art
 * in Tide tokens (currentColor), so every picture reads in light and dark and in any colorway.
 */

const STROKE = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** The Share button: a square with an arrow pointing up. */
export function ShareGlyph({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...STROKE} strokeWidth={1.9}>
      <path d="M8.5 9.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7.5a2 2 0 0 0-2-2h-1.5" />
      <path d="M12 14.5V3M8.2 6.6 12 2.8l3.8 3.8" />
    </svg>
  );
}

/** A plus in a square: the picture beside "Add to Home Screen". */
export function PlusSquareGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...STROKE} strokeWidth={1.9}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

/** Three dots, side by side or stacked. */
export function DotsGlyph({ size = 40, stacked = false }: { size?: number; stacked?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      {stacked ? (
        <>
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </>
      ) : (
        <>
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </>
      )}
    </svg>
  );
}

/** Three lines: Samsung Internet's menu button. */
export function LinesGlyph({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...STROKE} strokeWidth={2.2}>
      <path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h15" />
    </svg>
  );
}

/** A phone with a small arrow into it: "Add to Home screen" on Android. */
export function PhoneAddGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...STROKE} strokeWidth={1.9}>
      <rect x="6" y="2.5" width="12" height="19" rx="2.8" />
      <path d="M12 8v6M9.4 11.6 12 14.2l2.6-2.6" />
    </svg>
  );
}

/** A compass: the phone's own browser. */
export function CompassGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...STROKE} strokeWidth={1.9}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.6 8.4-2 5.2-5.2 2 2-5.2z" />
    </svg>
  );
}

/** The spot to tap: the glyph on a tinted tile with a ring that pulses once a second. */
function TapTile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("relative inline-flex h-[84px] w-[84px] items-center justify-center rounded-[24px] bg-tint text-accent-text", className)}>
      <span aria-hidden className="absolute inset-0 rounded-[24px] ring-2 ring-accent motion-safe:animate-ping" style={{ animationDuration: "1.8s" }} />
      <span aria-hidden className="absolute inset-0 rounded-[24px] ring-2 ring-accent" />
      <span className="relative">{children}</span>
    </span>
  );
}

/** The frame every picture sits in. */
function Stage({ children, label, stacked = false }: { children: ReactNode; label: string; stacked?: boolean }) {
  return (
    <div role="img" aria-label={label} className={cn("flex min-h-[132px] items-center justify-center overflow-hidden rounded-2xl bg-ink px-4 py-5", stacked ? "flex-col gap-3.5" : "gap-4")}>
      {children}
    </div>
  );
}

/** Under the button to tap: the other button some phones show in its place. */
function OrElse({ children, text }: { children: ReactNode; text: string }) {
  return (
    <span className="flex items-center gap-2 text-[13px] font-semibold text-gray-600">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-gray-700">{children}</span>
      {text}
    </span>
  );
}

/** A faint row of a phone menu, to set the highlighted row in its list. */
function GhostRow({ w }: { w: string }) {
  return (
    <div className="flex h-9 items-center justify-between px-3.5">
      <span className={cn("h-2 rounded-full bg-gray-200", w)} />
      <span className="h-4 w-4 rounded-[5px] bg-gray-200" />
    </div>
  );
}

/** A phone menu with one row lit: the row to tap. */
function MenuArt({ label, row, glyph }: { label: string; row: string; glyph: ReactNode }) {
  return (
    <Stage label={label}>
      <div className="w-full max-w-[280px] rounded-2xl bg-surface shadow-card">
        <GhostRow w="w-16" />
        <div className="relative mx-1 flex h-12 items-center justify-between rounded-xl bg-tint px-2.5 text-accent-text ring-2 ring-accent">
          <span className="text-[15px] font-bold tracking-[-0.01em]">{row}</span>
          {glyph}
        </div>
        <GhostRow w="w-24" />
      </div>
    </Stage>
  );
}

/** A phone's confirm bar with one button lit ("Add", "Install"). */
function ConfirmArt({ label, title, cancel = "Cancel", go }: { label: string; title: string; cancel?: string; go: string }) {
  return (
    <Stage label={label}>
      <div className="w-full max-w-[280px] rounded-2xl bg-surface p-3 shadow-card">
        <div className="flex items-center gap-2.5">
          <ScoreMark size={36} />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-bold text-gray-900">Scorecard</p>
            <p className="truncate text-[12px] font-medium text-gray-500">{title}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <span className="inline-flex h-9 items-center rounded-full px-3 text-[14px] font-semibold text-gray-500">{cancel}</span>
          <span className="relative inline-flex h-9 items-center rounded-full bg-tide-strong px-4 text-[14px] font-bold text-white">
            <span aria-hidden className="absolute -inset-1 rounded-full ring-2 ring-accent" />
            {go}
          </span>
        </div>
      </div>
    </Stage>
  );
}

export type ArtName =
  | "share"
  | "ios-row"
  | "ios-add"
  | "dots"
  | "app-dots"
  | "app-dots-stacked"
  | "lines"
  | "android-row"
  | "android-install"
  | "android-add"
  | "samsung-add-to"
  | "samsung-home"
  | "open-in-safari"
  | "open-in-chrome"
  | "home";

/** The picture for one tap. */
export function Art({ name }: { name: ArtName }) {
  switch (name) {
    case "share":
      return (
        <Stage stacked label="The Share button: a square with an arrow pointing up. Under it, three dots: tap those first when the Share button is hidden.">
          <TapTile>
            <ShareGlyph />
          </TapTile>
          <OrElse text="Hidden? Tap these three dots first.">
            <DotsGlyph size={20} />
          </OrElse>
        </Stage>
      );
    case "ios-row":
      return <MenuArt label="A list with the row Add to Home Screen, a plus in a square beside it" row="Add to Home Screen" glyph={<PlusSquareGlyph />} />;
    case "ios-add":
      return (
        <Stage label="The top of the screen with Cancel on the left and Add on the right">
          <div className="w-full max-w-[280px] rounded-2xl bg-surface p-3 shadow-card">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-medium text-gray-500">Cancel</span>
              <span className="relative inline-flex h-9 items-center rounded-full bg-tint px-4 text-[15px] font-bold text-accent-text ring-2 ring-accent">Add</span>
            </div>
            <div className="mt-3 flex items-center gap-2.5 border-t border-line pt-3">
              <ScoreMark size={40} />
              <span className="text-[15px] font-bold text-gray-900">Scorecard</span>
            </div>
          </div>
        </Stage>
      );
    case "app-dots":
    case "app-dots-stacked":
      return (
        <Stage stacked label="Three dots. Under them, the Share button: some apps show it in their place.">
          <TapTile>
            <DotsGlyph stacked={name === "app-dots-stacked"} />
          </TapTile>
          <OrElse text="Some apps show this button in their place.">
            <ShareGlyph size={20} />
          </OrElse>
        </Stage>
      );
    case "dots":
      return (
        <Stage label="Three dots, one over the other">
          <TapTile>
            <DotsGlyph stacked />
          </TapTile>
        </Stage>
      );
    case "lines":
      return (
        <Stage label="Three lines, one over the other">
          <TapTile>
            <LinesGlyph />
          </TapTile>
        </Stage>
      );
    case "android-row":
      return <MenuArt label="A menu with the row Add to Home screen" row="Add to Home screen" glyph={<PhoneAddGlyph />} />;
    case "android-install":
      return <ConfirmArt label="A small window with the buttons Cancel and Install" title="Install app" go="Install" />;
    case "android-add":
      return <ConfirmArt label="A small window with the buttons Cancel and Add" title="Add to Home screen" go="Add" />;
    case "samsung-add-to":
      return <MenuArt label="A menu with the row Add to" row="Add to" glyph={<PlusSquareGlyph />} />;
    case "samsung-home":
      return <MenuArt label="A list with the row Home screen" row="Home screen" glyph={<PhoneAddGlyph />} />;
    case "open-in-safari":
      return <MenuArt label="A menu with the row Open in Safari" row="Open in Safari" glyph={<CompassGlyph />} />;
    case "open-in-chrome":
      return <MenuArt label="A menu with the row Open in Chrome" row="Open in Chrome" glyph={<CompassGlyph />} />;
    case "home":
      return (
        <Stage label="Your Home Screen with the Scorecard icon on it">
          <div className="grid grid-cols-4 gap-x-4 gap-y-2">
            {[0, 1, 2, 3].map((i) =>
              i === 1 ? (
                <span key={i} className="flex flex-col items-center gap-1">
                  <span className="relative inline-flex rounded-[15px]">
                    <span aria-hidden className="absolute -inset-1 rounded-[18px] ring-2 ring-accent" />
                    <ScoreMark size={52} />
                  </span>
                  <span className="text-[11px] font-semibold text-gray-900">Scorecard</span>
                </span>
              ) : (
                <span key={i} className="flex flex-col items-center gap-1">
                  <span className="h-[52px] w-[52px] rounded-[14px] bg-gray-200" />
                  <span className="mt-1 h-1.5 w-8 rounded-full bg-gray-200" />
                </span>
              ),
            )}
          </div>
        </Stage>
      );
  }
}
