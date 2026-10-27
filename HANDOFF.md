# HANDOFF.md — Scorecard

## State (2026-10-27, release 1 built)
- PR #1 (release 1) was merged by the owner on 2026-10-27 at about 2 AM Detroit; Vercel is connected to the repo and deploys `main` (project `tkg-scorecard`, Supabase project `tkg-scorecard`). PR #2 (the colorway tooling and Crimson) follows on the same branch. The owner's clicks so far: SETUP steps 1 to 5 done (merged, Supabase project, SQL run, keys, Vercel deploy); next are the goal, the team, the TV. Original status: the owner runs SETUP.md Phase 1 (merge PR #1 so `main` carries the app, Supabase project, paste `0001_init.sql`, Vercel with the env vars, team, goal, the Mac mini on `/board`).
- Reviewed on 2026-10-27 by a six-lens adversarial pass (security, numbers, Next 16, Tide, data, the owner's morning): 24 confirmed findings fixed in the second commit (per-address login throttle, origin-checked sign-out, the month's own sales list, the Log form's day, no future days, pace text at the month's edges, the chart's business-day goal line drawn in pixels, forms keeping typed text after an error, the row menu escaping the card, light-mode up/down contrast, the board dark before paint, the Fix sheet's scrim, desk links from the request host, SETUP step numbers and the merge-first step, LOG_TOKEN length in Settings).
- Verified in the sandbox: `npm run lint`, `tsc`, 6 unit tests, `next build`, and `scripts/smoke.mjs` end to end on the local Postgres + PostgREST stand-in (39 checks: sign-in and refusals, seven people, duplicate refused, goals, six sales through the form, undo, bad amount blocked, Home totals, owner fix and remove, past month, phone layout without sideways scroll, board dark by default and no scroll at 1920x1080, T flips light, Shortcut endpoint logs/lists/refuses, the board celebrates the new sale with name and amount, team sign-in and its limits).

## Carriers (2026-10-27, owner: "instead of the client's name ... which carrier")
- Log a sale asks for the carrier (chips, required: AHL, AmAm, Americo, Foresters, Newbridge, Royal, UHL; editable in Settings > Carriers) and no longer asks for a client's name. `sales.carrier` comes from `0002_carrier.sql`, which the owner pastes before merging. The TV feed, the celebration, Home's sales rows, the Fix sheet and the Shortcut endpoint (`carrier` required, matched to the list in any case) all carry it. The `client` column stays, unused.

## Colorway (2026-10-27)
- The owner saw six colorways rendered from the real app (Crimson, Emerald, Lagoon, Champion, Sky, Field; `design/colorways.mjs` + `design/render-colorways.mjs`, output in the gitignored `design/out/`) and picked **Crimson** as the default, with Sky, Champion and Emerald switchable in Settings > Colorway. Icons and the link card are drawn in Crimson. A second designer pass proposed Arena (crimson to magenta), Turf, Emerald (teal-green), Jade and Trophy, contrast-checked; not rendered, kept in the session's workflow output in case he wants more later.

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
