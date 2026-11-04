# Scorecard by TKG

The team's month, live on the office TV: the leaderboard, team production against the goal, pace, today's sales, and confetti when a sale lands. A sibling of Sales Coach (same Tide look), for The Koka Group.

- Life and P&C: a P&C licensed person (Team page) logs a P&C sale with the Life / P&C switch; every premium counts, the split shows in purple on the bars, the TV ring and under every total.
- `/wrap`: the team's day, week or month on one iPhone screenshot for the group chat (Day / Week / Month switch; player of the period, best deal, the month's top three carriers, everybody; `?view=` and `?day=` for an earlier period)
- `/board`: the TV (full screen, refreshes itself, light or dark as set under Settings > TV look, plays the sale sound picked under Settings > Sale sound; F full screen)
- `/`: this month on a phone or computer, with earlier months
- `/log`: log a sale in four taps (who, how much, which carrier, Log it)
- `/team`, `/settings`: the people, their goals, the team goal, the board message, the colorway (Crimson by default; Sky, Champion, Emerald)

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
