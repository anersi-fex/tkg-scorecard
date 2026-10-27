# HANDOFF.md — Scorecard

## State (2026-10-27, release 1 built)
- Built overnight on the session branch, PR open as a draft. Not deployed yet: the owner runs SETUP.md Phase 1 (Supabase project, paste `0001_init.sql`, Vercel with the env vars, team, goal, the Mac mini on `/board`).
- Verified in the sandbox: `npm run lint`, `tsc`, 6 unit tests, `next build`, and `scripts/smoke.mjs` end to end on the local Postgres + PostgREST stand-in (32 checks: sign-in and refusals, seven people, duplicate refused, goals, six sales through the form, undo, bad amount blocked, Home totals, owner fix and remove, past month, phone layout without sideways scroll, board dark by default and no scroll at 1920x1080, T flips light, Shortcut endpoint logs/lists/refuses, the board celebrates the new sale with name and amount, team sign-in and its limits).

## Decisions made for the owner (say so in the first reply; easy to change)
- Two passwords (owner, team) instead of per-person accounts: the TV and seven phones sign in once; the team can log sales and take back their own within 15 minutes; the owner fixes or removes anything.
- The board is dark by default (T flips it, `?theme=light` pins it); the phone app follows the phone's setting.
- Pace counts business days Mon to Fri, today included in both elapsed and remaining.
- Leaderboard order: annual premium, then policies, then name. Rank 1 gets the crown and the gradient bar; a person's bar is against their own goal when set, else against the leader.
- "Policies" per sale defaults to 1; a bundle can be logged as one sale with N policies.
- A client's first name is optional and shows on the board ("Alex · Maria · Term"). Nothing else about the client is stored.

## Backlog (owner's words, not started)
- Deeper data from Sales Coach and the CRM: which leads, which states, phone numbers, dial time.
- NFC tags per desk (Phase 2 in SETUP.md works today with a link or a Shortcut; a native prompt on the TV side is not needed).
- A sound on the TV for a sale (browsers block autoplay; needs one click on the board page first).
- Weekly and quarterly views; year to date; streaks; "sale of the day".
- Fold everything into the CRM (`anersi-fex/tkg-crm` is empty).

## Gotchas
- `scripts/local-db/start.sh` ends with a check that the anon key is refused on `agents`; the migration revokes grants from `anon`/`authenticated` so that check (and the real Supabase keys) get an error, not an empty list.
- The React Compiler lint rules are strict: no `Date.now()` in render (freshness is computed on tap in `sale-row-menu.tsx`), no setState in an effect body (the celebration queue lives in refs, `showNext` chains timeouts).
- `PageProps<"/log">` etc. are generated types: run `npx next typegen` after adding a route.
- Playwright in the sandbox is global: `scripts/smoke.mjs` loads it through `createRequire` (or `PLAYWRIGHT_DIR`).
