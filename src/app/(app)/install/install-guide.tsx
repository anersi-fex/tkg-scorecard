"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { Button, Card, LinkButton, cn } from "@/components/ui";
import { toast } from "@/components/toaster";
import { Art, type ArtName } from "./install-art";
import { detectDevice, guideFor, type Device, type DeviceOs, type GuideKind } from "./detect";

/**
 * The phone guide (owner, 2026-11-12): it looks at the phone it is on, says how many taps it
 * takes, and walks through them one card at a time with a picture of the button to tap. Android
 * browsers that offer it get one button that does the whole thing. The wording keeps to what is
 * certain on every phone: buttons are named by their picture, each step is one tap.
 */

interface Step {
  text: string;
  hint?: string;
  art: ArtName;
}

const IOS_STEPS: Step[] = [
  { text: "Tap the Share button (a square with an arrow pointing up).", hint: "If you don't see it, tap the three dots first.", art: "share" },
  { text: "Scroll down and tap Add to Home Screen.", art: "ios-row" },
  { text: "Tap Add.", art: "ios-add" },
];

const STEPS: Partial<Record<GuideKind, Step[]>> = {
  "ios-safari": IOS_STEPS,
  "ios-browser": IOS_STEPS,
  "android-chrome": [
    { text: "Tap the three dots in the corner of the screen.", art: "dots" },
    { text: "Tap Add to Home screen.", hint: "It may say Install app.", art: "android-row" },
    { text: "Tap Install.", hint: "It may say Add.", art: "android-install" },
  ],
  "android-browser": [
    { text: "Tap the three dots in the corner of the screen.", art: "dots" },
    { text: "Tap Add to Home screen.", hint: "It may say Install, or Add app to Home screen.", art: "android-row" },
    { text: "Tap Add.", hint: "It may say Install.", art: "android-add" },
  ],
  "android-samsung": [
    { text: "Tap the three lines in the bottom corner.", art: "lines" },
    { text: "Tap Add to.", hint: "It may say Add page to.", art: "samsung-add-to" },
    { text: "Tap Home screen.", art: "samsung-home" },
    { text: "Tap Add.", art: "android-add" },
  ],
};

/** Chrome's install offer (Android): held until the person taps the button. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// What the phone says about itself, read once in the browser and again when it becomes an app.
let cached: Device | null = null;
function readDevice(): Device {
  if (cached) return cached;
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone = window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
  cached = detectDevice(nav.userAgent, { standalone, maxTouchPoints: nav.maxTouchPoints });
  return cached;
}
function subscribeDevice(onChange: () => void) {
  const mq = window.matchMedia("(display-mode: standalone)");
  const changed = () => {
    cached = null;
    onChange();
  };
  mq.addEventListener("change", changed);
  return () => mq.removeEventListener("change", changed);
}
const serverDevice = () => null;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function InstallGuide({ welcome, firstName, address }: { welcome: boolean; firstName: string | null; address: string }) {
  const device = useSyncExternalStore(subscribeDevice, readDevice, serverDevice);
  const [picked, setPicked] = useState<DeviceOs | null>(null);
  const [offer, setOffer] = useState<InstallPromptEvent | null>(null);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    const onOffer = (e: Event) => {
      e.preventDefault(); // keep the phone's own small banner back: the big button does it
      setOffer(e as InstallPromptEvent);
    };
    const onAdded = () => {
      setOffer(null);
      setAdded(true);
    };
    window.addEventListener("beforeinstallprompt", onOffer);
    window.addEventListener("appinstalled", onAdded);
    return () => {
      window.removeEventListener("beforeinstallprompt", onOffer);
      window.removeEventListener("appinstalled", onAdded);
    };
  }, []);

  const kind: GuideKind | null = device ? (picked ? (picked === device.os && device.kind !== "installed" ? device.kind : guideFor(picked)) : device.kind) : null;
  const os: DeviceOs | null = device ? (picked ?? device.os) : null;

  return (
    <div data-install={kind ?? "checking"} className="mx-auto w-full max-w-xl">
      <header className="mb-4">
        {welcome ? (
          <>
            <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.035em] text-gray-900">{firstName ? `Welcome, ${firstName}.` : "Welcome."}</h1>
            <p className="mt-1 text-[16px] font-semibold text-gray-700">One last step: put Scorecard on your phone.</p>
          </>
        ) : (
          <>
            <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.035em] text-gray-900">Put Scorecard on your phone</h1>
            <p className="mt-0.5 text-[14px] font-medium text-gray-500">It gets its own icon and opens like any other app.</p>
          </>
        )}
      </header>

      {!device || !kind || !os ? (
        <Card className="text-[15px] font-medium text-gray-500">Looking at your phone…</Card>
      ) : added || kind === "installed" ? (
        <Installed fresh={added && kind !== "installed"} />
      ) : kind === "computer" ? (
        <Computer address={address} detected={!picked} />
      ) : kind === "in-app" ? (
        <InApp device={device} address={address} />
      ) : (
        <PhoneSteps
          key={kind}
          kind={kind}
          device={device}
          byHand={picked !== null && picked !== device.os}
          offer={os === "android" ? offer : null}
          onInstalled={() => setAdded(true)}
          address={address}
          welcome={welcome}
        />
      )}

      {device && kind !== "installed" && !added && (
        <div className="mt-5 rounded-2xl border border-line px-3.5 py-3">
          <p className="text-[13px] font-bold text-gray-700">Not your phone?</p>
          <div role="group" aria-label="Pick your phone" className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-track p-1">
            {(
              [
                ["ios", "iPhone"],
                ["android", "Android"],
                ["computer", "Computer"],
              ] as Array<[DeviceOs, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={os === value}
                onClick={() => setPicked(value)}
                className={cn("min-h-11 rounded-[10px] text-[14px] transition-colors", os === value ? "bg-segment font-bold text-gray-900 shadow-card" : "font-semibold text-gray-600")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {welcome && kind !== "installed" && !added && (
        <p className="mt-4 text-center">
          <Link href="/" className="inline-flex min-h-11 items-center px-3 text-[15px] font-semibold text-accent-text">
            Skip for now
          </Link>
        </p>
      )}
    </div>
  );
}

/** "3 taps" up top, with what was detected under it. */
function Count({ taps, where }: { taps: number; where: string }) {
  return (
    <div className="mb-3 flex items-center gap-3 px-1">
      <span data-taps className="font-mono text-[44px] leading-none font-bold tracking-[-0.04em] text-accent-text">
        {taps}
      </span>
      <span className="min-w-0">
        <span className="block text-[17px] leading-tight font-extrabold tracking-[-0.02em] text-gray-900">{taps === 1 ? "tap" : "taps"}</span>
        <span className="block truncate text-[13px] font-medium text-gray-500">{where}</span>
      </span>
    </div>
  );
}

function NumberBadge({ n, state }: { n: ReactNode; state: "now" | "done" | "next" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-mono font-bold",
        state === "now" ? "h-12 w-12 bg-tide-strong text-[24px] text-white shadow-glow" : "h-9 w-9 text-[16px]",
        state === "done" && "bg-green-100 text-green-800",
        state === "next" && "bg-gray-100 text-gray-600",
      )}
    >
      {state === "done" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      ) : (
        n
      )}
    </span>
  );
}

function PhoneSteps({
  kind,
  device,
  byHand,
  offer,
  onInstalled,
  address,
  welcome,
}: {
  kind: GuideKind;
  device: Device;
  byHand: boolean;
  offer: InstallPromptEvent | null;
  onInstalled: () => void;
  address: string;
  welcome: boolean;
}) {
  const steps = STEPS[kind] ?? IOS_STEPS;
  const [at, setAt] = useState(0);
  const [manual, setManual] = useState(false);
  const [asking, setAsking] = useState(false);
  const last = steps.length; // the "Done?" card
  const where = byHand ? (kind === "ios-safari" ? "on an iPhone" : "on an Android phone") : `on your ${device.device}, in ${device.browser}`;

  // Android offered to do it: one button, then the phone's own "Install".
  if (offer && !manual) {
    const install = async () => {
      setAsking(true);
      try {
        await offer.prompt();
        const choice = await offer.userChoice;
        if (choice.outcome === "accepted") onInstalled();
      } catch {
        setManual(true); // the offer was used up or refused: the taps below still work
      } finally {
        setAsking(false);
      }
    };
    return (
      <>
        <Count taps={2} where={where} />
        <Card>
          <div className="flex items-start gap-3">
            <NumberBadge n={1} state="now" />
            <p className="pt-2.5 text-[18px] leading-snug font-bold tracking-[-0.02em] text-gray-900">Tap the button below.</p>
          </div>
          <Button type="button" data-install-button onClick={install} disabled={asking} className="mt-4 min-h-14 w-full rounded-2xl text-[17px]">
            Add Scorecard to my phone
          </Button>
          <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
            <NumberBadge n={2} state="next" />
            <p className="text-[16px] font-semibold text-gray-700">Tap Install when your phone asks.</p>
          </div>
        </Card>
        <p className="mt-3 px-1 text-[13px] font-medium text-gray-500">
          Nothing happened?{" "}
          <button type="button" onClick={() => setManual(true)} className="font-semibold text-accent-text underline">
            Do it by hand in 3 taps
          </button>
        </p>
      </>
    );
  }

  return (
    <>
      <Count taps={steps.length} where={where} />
      <ol className="space-y-2.5">
        {steps.map((s, i) => {
          const state = i === at ? "now" : i < at ? "done" : "next";
          if (state !== "now") {
            return (
              <li key={i}>
                <button type="button" onClick={() => setAt(i)} className="flex min-h-14 w-full items-center gap-3 rounded-[22px] bg-surface px-4 py-2.5 text-left shadow-card">
                  <NumberBadge n={i + 1} state={state} />
                  <span className={cn("text-[15px] leading-snug font-semibold", state === "done" ? "text-gray-500" : "text-gray-700")}>{s.text}</span>
                </button>
              </li>
            );
          }
          return (
            <li key={i} data-step={i + 1} aria-current="step">
              <Card className="outline-2 outline-accent">
                <div className="flex items-start gap-3">
                  <NumberBadge n={i + 1} state="now" />
                  <div className="min-w-0 pt-0.5">
                    <p className="text-[11px] font-bold tracking-[0.09em] text-gray-500 uppercase">
                      Tap {i + 1} of {steps.length}
                    </p>
                    <p className="mt-0.5 text-[18px] leading-snug font-bold tracking-[-0.02em] text-gray-900">{s.text}</p>
                    {s.hint && <p className="mt-1 text-[14px] font-medium text-gray-600">{s.hint}</p>}
                  </div>
                </div>
                <div className="mt-3.5">
                  <Art name={s.art} />
                </div>
                <div className="mt-3.5 flex gap-2">
                  {i > 0 && (
                    <Button type="button" variant="secondary" onClick={() => setAt(i - 1)} className="shrink-0">
                      Back
                    </Button>
                  )}
                  <Button type="button" data-next onClick={() => setAt(i + 1)} className="flex-1">
                    {i + 1 < steps.length ? "Next" : "I tapped Add"}
                  </Button>
                </div>
              </Card>
            </li>
          );
        })}
        <li data-step="done" aria-current={at === last ? "step" : undefined}>
          {at === last ? (
            <Card className="outline-2 outline-accent">
              <p className="text-[18px] leading-snug font-bold tracking-[-0.02em] text-gray-900">Done? Open Scorecard from your Home Screen.</p>
              <p className="mt-1 text-[14px] font-medium text-gray-600">Look for the podium. If it asks you to sign in, sign in once more: it stays signed in after that.</p>
              <div className="mt-3.5">
                <Art name="home" />
              </div>
              <div className="mt-3.5 flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setAt(0)} className="shrink-0">
                  Start over
                </Button>
                <LinkButton href="/" className="flex-1">
                  {welcome ? "Go to Scorecard" : "Back to Scorecard"}
                </LinkButton>
              </div>
            </Card>
          ) : (
            <button type="button" onClick={() => setAt(last)} className="flex min-h-14 w-full items-center gap-3 rounded-[22px] bg-surface px-4 py-2.5 text-left shadow-card">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4 11.5 12 4l8 7.5M6.5 10v9.5h11V10" />
                </svg>
              </span>
              <span className="text-[15px] leading-snug font-semibold text-gray-700">Done? Open Scorecard from your Home Screen.</span>
            </button>
          )}
        </li>
      </ol>
      {kind === "ios-browser" && (
        <p className="mt-3 px-1 text-[13px] font-medium text-gray-500">
          No &quot;Add to Home Screen&quot; in the list? Open this page in Safari and do the same three taps. <CopyLink address={address} inline />
        </p>
      )}
    </>
  );
}

function CopyLink({ address, inline = false }: { address: string; inline?: boolean }) {
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    if (await copyText(address)) toast("Link copied. Paste it in your phone's browser.");
    else setFailed(true);
  };
  if (!address) return null;
  if (inline) {
    return (
      <button type="button" data-copy onClick={copy} className="font-semibold text-accent-text underline">
        {failed ? "Press and hold the address bar to copy the link" : "Copy link"}
      </button>
    );
  }
  return (
    <>
      <Button type="button" data-copy variant="secondary" onClick={copy} className="w-full">
        Copy link
      </Button>
      {failed && <p className="mt-2 text-[13px] font-medium text-gray-600">Copying is blocked here. Press and hold the address above, then tap Copy.</p>}
    </>
  );
}

function AddressBox({ address }: { address: string }) {
  if (!address) return null;
  return (
    <p data-address className="mt-3 rounded-xl bg-ink px-3 py-2.5 font-mono text-[14px] font-semibold break-all text-gray-900 select-all">
      {address.replace(/^https?:\/\//, "")}
    </p>
  );
}

function Installed({ fresh }: { fresh: boolean }) {
  return (
    <Card className="text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-800">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      </span>
      <p className="mt-3 text-[20px] leading-tight font-extrabold tracking-[-0.03em] text-gray-900">You&apos;re all set.</p>
      <p className="mt-1 text-[15px] font-medium text-gray-600">{fresh ? "Scorecard is on your Home Screen now. Open it from there next time." : "Scorecard is on your Home Screen."}</p>
      <LinkButton href="/" className="mt-4 w-full">
        Go to Home
      </LinkButton>
    </Card>
  );
}

function Computer({ address, detected }: { address: string; detected: boolean }) {
  return (
    <Card>
      <p className="text-[18px] leading-snug font-bold tracking-[-0.02em] text-gray-900">This guide is for your phone.</p>
      <p className="mt-1 text-[15px] font-medium text-gray-600">Open this address on your phone:</p>
      <AddressBox address={address} />
      <div className="mt-3">
        <CopyLink address={address} />
      </div>
      <p className="mt-3 border-t border-line pt-3 text-[14px] font-medium text-gray-600">
        {detected ? "On this computer, " : "On a computer, "}simply bookmark this site. There is nothing to add.
      </p>
    </Card>
  );
}

function InApp({ device, address }: { device: Device; address: string }) {
  const ios = device.os === "ios";
  const browser = ios ? "Safari" : "Chrome";
  const app = device.inApp && device.inApp !== "an app" ? device.inApp : "another app";
  // The phone's own way to hand a link to its browser. Apps that block it leave the two taps below.
  let jump = "";
  try {
    const u = new URL(address);
    jump = ios ? `x-safari-${u.href}` : `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(":", "")};package=com.android.chrome;end`;
  } catch {
    jump = "";
  }
  const steps: Step[] = [
    { text: "Tap the three dots on this screen.", hint: "Some apps show the Share button (a square with an arrow) in their place.", art: ios ? "share" : "dots" },
    { text: `Tap Open in ${browser}.`, hint: "It may say Open in browser.", art: ios ? "open-in-safari" : "open-in-chrome" },
  ];
  return (
    <>
      <Card>
        <p className="text-[20px] leading-tight font-extrabold tracking-[-0.03em] text-gray-900">Open this in {browser}</p>
        <p className="mt-1 text-[15px] font-medium text-gray-600">
          You opened this inside {app}. It can&apos;t put Scorecard on your phone from here. {browser} can.
        </p>
        {jump && (
          <a href={jump} data-jump className="mt-4 inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-tide-strong px-4 text-[17px] font-bold text-white shadow-glow">
            Open in {browser}
          </a>
        )}
        <div className="mt-3">
          <CopyLink address={address} />
        </div>
        <p className="mt-2 text-[13px] font-medium text-gray-500">You will sign in once more in {browser}. Then this guide shows the taps.</p>
      </Card>
      <p className="mt-4 mb-2 px-1 text-[13px] font-bold text-gray-700">Nothing happened? 2 taps do the same:</p>
      <ol className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={i}>
            <Card>
              <div className="flex items-start gap-3">
                <NumberBadge n={i + 1} state="now" />
                <div className="min-w-0 pt-0.5">
                  <p className="text-[17px] leading-snug font-bold tracking-[-0.02em] text-gray-900">{s.text}</p>
                  {s.hint && <p className="mt-1 text-[14px] font-medium text-gray-600">{s.hint}</p>}
                </div>
              </div>
              <div className="mt-3.5">
                <Art name={s.art} />
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}
