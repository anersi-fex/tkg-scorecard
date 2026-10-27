import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { THEME_SCRIPT } from "../src/lib/theme-script";

/** Runs the pre-paint script against a stand-in page and returns the data-theme it set. */
function decide(opts: { path: string; search?: string; saved?: string | null; boardTheme?: string | null; storageThrows?: boolean }): string | null {
  const attrs: Record<string, string> = {};
  if (opts.boardTheme) attrs["data-board-theme"] = opts.boardTheme;
  const sandbox = {
    document: {
      documentElement: {
        getAttribute: (k: string) => attrs[k] ?? null,
        setAttribute: (k: string, v: string) => {
          attrs[k] = v;
        },
      },
    },
    location: { pathname: opts.path, search: opts.search ?? "" },
    localStorage: {
      getItem: () => {
        if (opts.storageThrows) throw new Error("private mode");
        return opts.saved ?? null;
      },
    },
    URLSearchParams,
  };
  vm.runInNewContext(THEME_SCRIPT, sandbox);
  return attrs["data-theme"] ?? null;
}

test("the TV opens in the owner's TV look, dark when there is none", () => {
  assert.equal(decide({ path: "/board" }), "dark");
  assert.equal(decide({ path: "/board", boardTheme: "dark" }), "dark");
  assert.equal(decide({ path: "/board", boardTheme: "light" }), "light");
  assert.equal(decide({ path: "/board", boardTheme: "sepia" }), "dark");
});

test("the TV ignores this browser's saved app theme and anything in the address", () => {
  assert.equal(decide({ path: "/board", saved: "light" }), "dark");
  assert.equal(decide({ path: "/board", saved: "dark", boardTheme: "light" }), "light");
  assert.equal(decide({ path: "/board", search: "?theme=light" }), "dark");
  assert.equal(decide({ path: "/board", search: "?theme=dark", boardTheme: "light" }), "light");
});

test("the phone app follows its own saved choice and never the TV look", () => {
  assert.equal(decide({ path: "/", saved: "light", boardTheme: "dark" }), "light");
  assert.equal(decide({ path: "/settings", saved: "dark", boardTheme: "light" }), "dark");
  assert.equal(decide({ path: "/", boardTheme: "light" }), null);
  assert.equal(decide({ path: "/", saved: "system" }), null);
});

test("a browser that blocks storage still gets the TV look", () => {
  assert.equal(decide({ path: "/board", boardTheme: "light", storageThrows: true }), "light");
  assert.equal(decide({ path: "/board", storageThrows: true }), "dark");
  assert.equal(decide({ path: "/", storageThrows: true }), null);
});
