import type { Viewport } from "next";

/**
 * The phone app draws at 85%, like Sales Coach (owner, 2026-10-29: "make the UI smaller and things
 * a bit more legible ... match that with Scorecard"): the page lays out a little wider than the
 * screen (390 / 0.85 = 459 px on most iPhones) and is drawn smaller, so text, buttons, cards and
 * spacing all shrink together. Computers ignore the tag. The maximum keeps an iPhone from zooming
 * in on a tapped text box (WebKit's focus zoom stops at the page's own maximum scale; a pinch can
 * still zoom past it in Safari). The TV board keeps the root layout's plain viewport.
 */
export const PHONE_VIEWPORT: Viewport = {
  width: "device-width",
  initialScale: 0.85,
  maximumScale: 0.85,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f3f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d12" },
  ],
};
