import { test } from "node:test";
import assert from "node:assert/strict";
import { detectDevice, guideFor, tapCount } from "../src/app/(app)/install/detect";

// Real user-agent strings, as the browsers send them.
const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  iphoneEdge: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/141.0.3537.57 Mobile/15E148 Safari/605.1.15",
  iphoneFirefox: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15",
  ipadSafariDesktopMode: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  ipadSafariOld: "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
  androidChrome: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  androidEdge: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 EdgA/141.0.0.0",
  androidSamsung: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22G86 Instagram 398.0.0.28.80 (iPhone16,2; iOS 18_6; en_US; en; scale=3.00; 1290x2796; 775031462)",
  iphoneFacebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22G86 [FBAN/FBIOS;FBAV/530.0.0.48.74;FBBV/790123456;FBDV/iPhone16,2;FBMD/iPhone;FBSN/iOS;FBSV/18.6;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/80]",
  iphoneMessenger:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22G86 [FBAN/MessengerLiteForiOS;FBAV/520.0.0.38.107;FBBV/780000000;FBDV/iPhone16,2;FBMD/iPhone;FBSN/iOS;FBSV/18.6;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/0]",
  androidFacebook:
    "Mozilla/5.0 (Linux; Android 14; SM-S918U Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.43 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/530.0.0.50.72;]",
  androidTikTok:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.43 Mobile Safari/537.36 trill_2023807060 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/38.7.6 ByteLocale/en ByteFullLocale/en Region/US BytedanceWebview/d8a21c6",
  iphoneLinkedIn: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.31.3214",
  iphoneSnapchat: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Snapchat/13.60.0.42 (like Safari/8621.3.11.10.3, panda)",
  iphoneGoogleApp: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/390.0.812345678 Mobile/15E148 Safari/604.1",
  iphoneUnknownWebView: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  androidUnknownWebView: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.43 Mobile Safari/537.36",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  windowsFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
};

test("an iPhone in Safari gets the three Safari taps", () => {
  const d = detectDevice(UA.iphoneSafari);
  assert.deepEqual([d.kind, d.os, d.device, d.browser, d.inApp], ["ios-safari", "ios", "iPhone", "Safari", null]);
  assert.equal(tapCount(d.kind), 3);
});

test("an iPhone in Chrome, Edge or Firefox is told apart from Safari", () => {
  for (const [ua, browser] of [
    [UA.iphoneChrome, "Chrome"],
    [UA.iphoneEdge, "Edge"],
    [UA.iphoneFirefox, "Firefox"],
  ] as const) {
    const d = detectDevice(ua);
    assert.equal(d.kind, "ios-browser", browser);
    assert.equal(d.browser, browser);
    assert.equal(d.device, "iPhone");
    assert.equal(tapCount(d.kind), 3);
  }
});

test("an iPad counts as an iPhone guide, even when it says it is a Mac", () => {
  const old = detectDevice(UA.ipadSafariOld);
  assert.deepEqual([old.kind, old.device], ["ios-safari", "iPad"]);
  // iPadOS asks for desktop sites: the address says Macintosh, the touch screen gives it away
  const now = detectDevice(UA.ipadSafariDesktopMode, { maxTouchPoints: 5 });
  assert.deepEqual([now.kind, now.os, now.device, now.browser], ["ios-safari", "ios", "iPad", "Safari"]);
  // The very same address from a real Mac (no touch screen) is a computer
  assert.equal(detectDevice(UA.macSafari, { maxTouchPoints: 0 }).kind, "computer");
});

test("Android: Chrome and Edge can install, Samsung Internet and Firefox get their own taps", () => {
  assert.deepEqual([detectDevice(UA.androidChrome).kind, detectDevice(UA.androidChrome).browser], ["android-chrome", "Chrome"]);
  assert.deepEqual([detectDevice(UA.androidEdge).kind, detectDevice(UA.androidEdge).browser], ["android-chrome", "Edge"]);
  const samsung = detectDevice(UA.androidSamsung);
  assert.deepEqual([samsung.kind, samsung.browser, samsung.device], ["android-samsung", "Samsung Internet", "Android phone"]);
  assert.equal(tapCount(samsung.kind), 4);
  const fx = detectDevice(UA.androidFirefox);
  assert.deepEqual([fx.kind, fx.browser, fx.os], ["android-browser", "Firefox", "android"]);
});

test("a link opened inside another app is sent to the real browser, by the app's name", () => {
  for (const [ua, app, os] of [
    [UA.iphoneInstagram, "Instagram", "ios"],
    [UA.iphoneFacebook, "Facebook", "ios"],
    [UA.iphoneMessenger, "Messenger", "ios"],
    [UA.androidFacebook, "Facebook", "android"],
    [UA.androidTikTok, "TikTok", "android"],
    [UA.iphoneLinkedIn, "LinkedIn", "ios"],
    [UA.iphoneSnapchat, "Snapchat", "ios"],
    [UA.iphoneGoogleApp, "the Google app", "ios"],
  ] as const) {
    const d = detectDevice(ua);
    assert.equal(d.kind, "in-app", app);
    assert.equal(d.inApp, app);
    assert.equal(d.os, os, app);
  }
});

test("an app's browser that does not say its name is still caught", () => {
  assert.deepEqual([detectDevice(UA.iphoneUnknownWebView).kind, detectDevice(UA.iphoneUnknownWebView).inApp], ["in-app", "an app"]);
  assert.deepEqual([detectDevice(UA.androidUnknownWebView).kind, detectDevice(UA.androidUnknownWebView).inApp], ["in-app", "an app"]);
});

test("a computer is a computer, whatever the browser", () => {
  for (const [ua, browser] of [
    [UA.macSafari, "Safari"],
    [UA.windowsChrome, "Chrome"],
    [UA.windowsEdge, "Edge"],
    [UA.windowsFirefox, "Firefox"],
  ] as const) {
    const d = detectDevice(ua);
    assert.deepEqual([d.kind, d.os, d.device, d.browser], ["computer", "computer", "computer", browser]);
    assert.equal(tapCount(d.kind), 0);
  }
});

test("opened from the Home Screen wins over everything else", () => {
  assert.equal(detectDevice(UA.iphoneSafari, { standalone: true }).kind, "installed");
  assert.equal(detectDevice(UA.androidChrome, { standalone: true }).kind, "installed");
  assert.equal(detectDevice(UA.windowsChrome, { standalone: true }).kind, "installed");
  assert.equal(detectDevice(UA.iphoneSafari, { standalone: false }).kind, "ios-safari");
});

test("an empty or odd user agent never throws and falls back to the computer page", () => {
  assert.equal(detectDevice("").kind, "computer");
  assert.equal(detectDevice("curl/8.5.0").kind, "computer");
});

test("picking a phone by hand opens that phone's guide", () => {
  assert.equal(guideFor("ios"), "ios-safari");
  assert.equal(guideFor("android"), "android-chrome");
  assert.equal(guideFor("computer"), "computer");
});
