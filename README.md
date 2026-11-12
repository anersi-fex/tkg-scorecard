# Scorecard by TKG

The team's month, live on the office TV: the leaderboard, production against the goal, pace, today's sales, and confetti when a sale lands. A sibling of Sales Coach (same Tide look), by The Koka Group. Since 2026-11-12 it is set up for a whole agency, Lineage Financial: the agency's name is a setting and shows beside TKG's ("by TKG × Lineage Financial").

- Everyone has their own sign-in: a cell number and a password they pick. One join link signs up the whole agency (`/join/...`), and a leader can have a link that lands people on their team. Someone already on the board taps their own name on the join card and keeps their row. The owner password and the team password (the TV, and phones that have not joined yet) still work.
- People and teams (`/team`, the People tab): who is on whose team (uplines), who works in the office, each person's month and goal. The office group is at the top of the leaderboards.
- Levels: the owner; admins, who run the goals, the people, this month's sales and the board; members, who log their own sales. Two things an admin asks for wait for the owner's yes (`/approvals`): making or removing an admin, and changing a sale of a past month.
- `/scoreboard`: the agency's numbers laid out like its CRM: production, policies sold and active agents against the same days of last month, where agents stand, who moved most this week, and the production leaderboard by day, product or carrier, for agents or teams, for the whole agency or one team, with a CSV export.
- `/board`: the TV (full screen, refreshes itself, rotates Leaderboard, Scoreboard, Production and Teams or keeps the screen picked under Settings > TV screens, light or dark as set under Settings > TV look, plays the sale sound picked under Settings > Sale sound; F full screen)
- `/`: this month on a phone or computer, with earlier months; the office group first, and My team for someone with a team
- `/log`: log a sale in four taps (who, how much, which carrier, Log it); a member logs their own
- `/wrap`: the team's day, week or month on one iPhone screenshot for the group chat (Day / Week / Month switch; player of the period, best deal, the month's top three carriers, everybody, or the top six and one line for the rest once 8 or more people sold; `?view=` and `?day=` for an earlier period)
- `/install`: a guide that puts Scorecard on a phone's Home Screen: it sees which phone and browser it is on, says how many taps it takes, and shows each one
- `/me`: a person's own name, cell number, office switch and password
- `/settings` (the owner and the admins): the goal, the agency's name, the board message, the carriers and products, the TV screens, the sale sound, the colorway (Crimson by default; Sky, Champion, Emerald)
- Life insurance only. P&C (a P&C licensed person logging P&C sales, with its own goal, board and color and an agency total of both) is still in the app behind one owner-only switch at the bottom of Settings, off by default.

Setup for the owner is in `SETUP.md`. Working notes for Claude are in `CLAUDE.md` and `HANDOFF.md`.

## Run and check
```
npm install
npm run dev
npm run lint && npx tsc --noEmit && npm test && npm run build
```
End to end on a local stand-in for Supabase (Postgres 16 + PostgREST, invented data):
```
scripts/local-db/start.sh --reset
set -a; . .local-db/env; set +a
OWNER_PASSWORD=owner-pass TEAM_PASSWORD=team-pass LOG_TOKEN=abcdefghijklmnop-token APP_URL=http://localhost:3000 npm run build && npm start
# in another shell, same env:
node scripts/smoke.mjs     # screenshots land in test-results/
```
Run it on a fresh database and a freshly started server each time: the server's memory keeps wrong sign-in tries for 15 minutes. On 2026-11-12: 403 checks with `LOG_TOKEN` (385 without it), about 210 seconds; `npm test` runs 131 unit tests.
