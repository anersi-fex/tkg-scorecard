/**
 * The TV's poll, pure parts (tests/board-poll.test.ts). A poll that is still waiting on the
 * database must never be joined by the next one: a slow database would stack requests, each making
 * it slower. And a request that never answers must end, so the next poll can recover.
 */

/** One poll may take this long (the server's database read gives up at 8 s too). */
export const POLL_TIMEOUT_MS = 8000;

/** The failure page asks again this often (it reloads itself, which reads the board on the server again). */
export const RETRY_MS = 15000;

/** One poll at a time: `begin()` is false while one is in flight; `end()` lets the next tick through. */
export function pollGate(): { begin: () => boolean; end: () => void; busy: () => boolean } {
  let inFlight = false;
  return {
    begin() {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    end() {
      inFlight = false;
    },
    busy: () => inFlight,
  };
}

/** Fetches with a limit: the request is cut after `ms` and rejects, like any failed poll. */
export function fetchWithin(url: string, ms: number = POLL_TIMEOUT_MS, impl: typeof fetch = fetch): Promise<Response> {
  return impl(url, { cache: "no-store", signal: AbortSignal.timeout(ms) });
}
