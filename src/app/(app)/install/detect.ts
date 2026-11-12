/**
 * Which phone and browser is looking at the "put it on your phone" guide (owner, 2026-11-12:
 * "depending on the phone, maybe automatically detect it"). Pure and browser-safe: the page
 * hands in `navigator.userAgent` and the few facts a user agent cannot tell (tests/install.test.ts).
 */

/** The guide a person gets. */
export type GuideKind =
  /** Opened from the Home Screen already. */
  | "installed"
  /** iPhone or iPad, in Safari. */
  | "ios-safari"
  /** iPhone or iPad, in Chrome, Edge, Firefox or another full browser. */
  | "ios-browser"
  /** Android, in Chrome or Edge (these can offer the one-tap install). */
  | "android-chrome"
  /** Android, in Samsung Internet. */
  | "android-samsung"
  /** Android, in Firefox or another full browser. */
  | "android-browser"
  /** A page opened inside another app (Instagram, Facebook, TikTok ...): it cannot add to the Home Screen. */
  | "in-app"
  /** A computer. */
  | "computer";

export type DeviceOs = "ios" | "android" | "computer";

export interface DeviceExtras {
  /** `matchMedia("(display-mode: standalone)").matches` or `navigator.standalone === true`. */
  standalone?: boolean;
  /** `navigator.maxTouchPoints`: an iPad says it is a Mac, and only this tells the two apart. */
  maxTouchPoints?: number;
}

export interface Device {
  kind: GuideKind;
  os: DeviceOs;
  /** "iPhone", "iPad", "Android phone" or "computer", for the line that says what was detected. */
  device: string;
  /** "Safari", "Chrome", "Edge", "Firefox", "Samsung Internet", or the app's name for an in-app browser. */
  browser: string;
  /** The app whose built-in browser this is ("Instagram"), or null. */
  inApp: string | null;
}

/** Apps that open links in their own small browser, which cannot add a page to the Home Screen. */
const IN_APP: Array<[RegExp, string]> = [
  [/Instagram/i, "Instagram"],
  [/FBAN\/Messenger|FBAV\/.*Messenger|MessengerForiOS|MessengerLiteForiOS|Orca-Android|FB_IAB\/(?:Orca|MESSENGER)/i, "Messenger"],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i, "Facebook"],
  [/musical_ly|BytedanceWebview|TikTok|trill_/i, "TikTok"],
  [/LinkedInApp/i, "LinkedIn"],
  [/Snapchat/i, "Snapchat"],
  [/\bTwitter(?:Android|\s+for\s+iPhone)?\b/i, "X"],
  [/Pinterest/i, "Pinterest"],
  [/MicroMessenger/i, "WeChat"],
  [/\bLine\//i, "LINE"],
  [/WhatsApp/i, "WhatsApp"],
  [/TelegramBot|Telegram-Android|Telegram\//i, "Telegram"],
  [/\bGSA\//i, "the Google app"],
  [/GoogleApp|Gmail/i, "Gmail"],
  [/Slack(?:\/|_SSB)/i, "Slack"],
  [/Outlook-(?:iOS|Android)|Microsoft Outlook/i, "Outlook"],
];

function inAppName(ua: string): string | null {
  for (const [re, name] of IN_APP) if (re.test(ua)) return name;
  return null;
}

export function detectDevice(ua: string, extras: DeviceExtras = {}): Device {
  const touch = extras.maxTouchPoints ?? 0;
  const iPhone = /iPhone|iPod/.test(ua);
  // An iPad asks for the desktop site by default: "Macintosh" with a touch screen.
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
  const android = /Android/i.test(ua);
  const os: DeviceOs = iPhone || iPad ? "ios" : android ? "android" : "computer";
  const device = iPhone ? "iPhone" : iPad ? "iPad" : android ? (/Mobile/.test(ua) ? "Android phone" : "Android tablet") : "computer";

  let browser = "your browser";
  if (os === "ios") {
    if (/CriOS/.test(ua)) browser = "Chrome";
    else if (/EdgiOS/.test(ua)) browser = "Edge";
    else if (/FxiOS/.test(ua)) browser = "Firefox";
    else if (/OPiOS|OPT\//.test(ua)) browser = "Opera";
    else if (/DuckDuckGo/.test(ua)) browser = "DuckDuckGo";
    else if (/Brave/.test(ua)) browser = "Brave";
    else if (/Safari\//.test(ua)) browser = "Safari";
  } else if (os === "android") {
    if (/SamsungBrowser/.test(ua)) browser = "Samsung Internet";
    else if (/EdgA\//.test(ua)) browser = "Edge";
    else if (/Firefox\//.test(ua)) browser = "Firefox";
    else if (/OPR\//.test(ua)) browser = "Opera";
    else if (/DuckDuckGo/.test(ua)) browser = "DuckDuckGo";
    else if (/Chrome\//.test(ua)) browser = "Chrome";
  } else {
    if (/Edg\//.test(ua)) browser = "Edge";
    else if (/OPR\//.test(ua)) browser = "Opera";
    else if (/Firefox\//.test(ua)) browser = "Firefox";
    else if (/Chrome\//.test(ua)) browser = "Chrome";
    else if (/Safari\//.test(ua)) browser = "Safari";
  }

  if (extras.standalone) return { kind: "installed", os, device, browser, inApp: null };

  if (os !== "computer") {
    let app = inAppName(ua);
    // An app's built-in browser that does not say its name: Android marks it "; wv)", and on an
    // iPhone it leaves out the "Safari/" word every real browser there carries.
    if (!app && os === "android" && /; wv\)/.test(ua)) app = "an app";
    if (!app && os === "ios" && /AppleWebKit/.test(ua) && !/Safari\//.test(ua)) app = "an app";
    if (app) return { kind: "in-app", os, device, browser: app, inApp: app };
  }

  if (os === "ios") return { kind: browser === "Safari" ? "ios-safari" : "ios-browser", os, device, browser, inApp: null };
  if (os === "android") {
    const kind: GuideKind = browser === "Samsung Internet" ? "android-samsung" : browser === "Chrome" || browser === "Edge" ? "android-chrome" : "android-browser";
    return { kind, os, device, browser, inApp: null };
  }
  return { kind: "computer", os, device, browser, inApp: null };
}

/** How many taps the hand-made steps take for a guide (the number up top). */
export function tapCount(kind: GuideKind): number {
  if (kind === "android-samsung") return 4;
  if (kind === "ios-safari" || kind === "ios-browser" || kind === "android-chrome" || kind === "android-browser") return 3;
  if (kind === "in-app") return 2;
  return 0;
}

/** The guide to show when a person picks their phone by hand ("Not your phone?"). */
export function guideFor(choice: DeviceOs): GuideKind {
  return choice === "ios" ? "ios-safari" : choice === "android" ? "android-chrome" : "computer";
}
