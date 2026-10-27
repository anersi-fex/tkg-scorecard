# CLAUDE.md — Scorecard

**Owner:** Anersi Koka (The Koka Group, Troy MI). Licensed MI P&C and life producer at Goosehead; runs a life-insurance phone sales team of seven. Not a developer: one step at a time, verdict first, visual when possible, receipts before "done". Short replies.

## What this is
A sibling of Sales Coach (`anersi-fex/tkg-sales-coach`) with the same Tide look: a TV board for the office (a Mac mini on HDMI) showing the team's month, and a small phone app to feed it. Release 1 (2026-10-27, built overnight for a 7 AM deadline): the board (`/board`), This month (`/`, earlier months with `?month=`), Log a sale (`/log`, `?agent=<id>` preselects a person for a desk NFC tag), Team (`/team`), Settings (`/settings`, owner only), a Shortcut endpoint (`POST /api/sales` with `LOG_TOKEN`). Later, as the owner asked: deeper data from Sales Coach and the CRM (which leads, states, numbers, dial time), then everything folds into one CRM.

## Rules
- The owner approves scope before code. Build small, verified steps. Nothing here is AI-scored or AI-generated; the numbers are what people typed.
- Privacy: a sale carries an agent, an annual premium, a product and an optional client first name. Never store policy numbers, birthdates, contact details. Logs carry ids and error classes only.
- Secrets only in env vars. Never in chat, code, git or logs. Never put model identifiers in commits, PR text or code.
- Look: Tide, identical tokens to Sales Coach (`src/app/globals.css`). Every color is a CSS variable with light and dark values; never hardcode a hex, `rgb()`, `white/` or `black/` color in a component (the confetti canvas is the one exception, it is paper). Plus Jakarta Sans for text, Space Grotesk (`font-mono`) for numbers. iPhone-style grouped lists, floating tab bar on phones, the initials menu top right (theme, TV board, Settings, Sign out).
- Brand: `src/components/brand.tsx` (ScoreMark: a white podium with a star on the cobalt-to-violet squircle; TkgMark; ScoreLockup "Scorecard by TKG"). `public/` icons, `og.jpg` and the iPhone opening screens come from `scripts/gen-icons.mjs` (`npm run icons`), same geometry; keep the two in sync.

## Stack (match the owner's other apps; do not substitute)
- Next.js 16.3.4 App Router (TypeScript strict, Tailwind 4, React 19), `src/proxy.ts` (not middleware), async `params`/`searchParams`/`cookies()`. Read `node_modules/next/dist/docs/` before a new convention.
- Supabase Postgres (its own project) through `@supabase/supabase-js` with the service role key, server only (`src/lib/supabase.ts`). The browser never talks to Supabase. RLS on with no policies plus revoked grants for anon/authenticated (`supabase/migrations/0001_init.sql`).
- Sign-in: two passwords, `OWNER_PASSWORD` (Anersi: full control) and `TEAM_PASSWORD` (everyone and the TV: log sales, see everything), checked in constant time (`src/lib/auth.ts` `roleForPassword`), HMAC-signed stateless cookie with the role and a password tag (`src/lib/session.ts`; changing a password signs out that role's devices), 180-day cookie, DB-backed login throttle. `requirePage()` in every page, `requireRole()` in every action; `requireRole("owner")` for goals, team edits, fixing or removing any sale. The team can take back a sale logged in the last 15 minutes.
- Data (`src/lib/data.ts`): `agents` (never deleted, `active` false = off the board), `sales` (cents, `sold_on` Detroit date, soft `deleted_at`), `goals` (team, per month), `agent_goals`, `settings` (key `app`: board message, product chips), `login_attempts`.
- Math (`src/lib/month.ts`, pure, tested in `tests/month.test.ts`): Detroit dates, business days (Mon to Fri), `monthClock` (elapsed, remaining, today included on both sides), `pace` (projected, expected on a straight line to the goal, ahead/behind, needed per remaining day). `src/lib/board.ts` builds one `MonthSnapshot` for the board, Home and the recap (`buildSnapshot` is pure; leaderboard ranks by premium, then policies, then name).
- The board (`src/components/board/board-view.tsx`): one screen sized in `em` from the viewport (`clamp(10px, min(1vw, 1.78vh), 36px)`), polls `GET /api/board` every 5 s, celebrates each sale id it has not seen (queue, 9 s each, confetti from `confetti.ts`), dark unless `?theme=light` or a saved choice, F full screen, T flips theme, wake lock, cursor hides when still.
- Timezone: America/Detroit everywhere (`src/lib/timezone.ts`).

## How to run and check
- `npm install`, `npm run dev`. Before every push: `npm run lint`, `npx tsc --noEmit` (`npx next typegen` first when routes change), `npm test`, `npm run build`.
- End to end: `scripts/local-db/start.sh --reset` (Postgres 16 + PostgREST stand-in, needs `/usr/lib/postgresql/16`), then build and start the app with the env in `.local-db/env` plus `OWNER_PASSWORD`, `TEAM_PASSWORD`, `LOG_TOKEN`, `APP_URL`, then `node scripts/smoke.mjs` (Playwright; screenshots in `test-results/`). Run it on a fresh database.
- Env vars: see `SETUP.md` (no `.env.example`; `.env*` is gitignored).

## Git
- Work only in this repo. Develop on the branch the session assigns; open a draft PR. Vercel deploys `main`.
- Migrations live in `supabase/migrations/`; the owner pastes each new file into the Supabase SQL editor. Anything that needs a new migration merges only after the owner ran it.

**Update `HANDOFF.md` at every milestone.**
