/**
 * Chrome on Android offers to install the site once per page load (`beforeinstallprompt`), and
 * that is usually before the phone guide is on screen: on the sign-in or join page, or on Home
 * before someone taps the menu link. The root layout runs this inline in <head> on every page: it
 * holds the offer back (the phone's own small banner stays away) and keeps it on `window` for the
 * guide's one button. Plain strings and types only, so the server layout can import it.
 */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    /** The held install offer; null once it was used or the app was installed. */
    __scInstallOffer?: InstallPromptEvent | null;
  }
}

export const INSTALL_OFFER_SCRIPT = `try{addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__scInstallOffer=e});addEventListener("appinstalled",function(){window.__scInstallOffer=null})}catch(e){}`;

/** The offer the page already holds, if any (null on the server). */
export function heldInstallOffer(): InstallPromptEvent | null {
  return typeof window === "undefined" ? null : (window.__scInstallOffer ?? null);
}
