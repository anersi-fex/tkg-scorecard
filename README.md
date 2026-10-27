# Scorecard by TKG

The team's month, live on the office TV: the leaderboard, team production against the goal, pace, today's sales, and confetti when a sale lands. A sibling of Sales Coach (same Tide look), for The Koka Group.

- `/board`: the TV (full screen, refreshes itself, dark by default; F full screen, T light/dark)
- `/`: this month on a phone or computer, with earlier months
- `/log`: log a sale in three taps (who, how much, Log it)
- `/team`, `/settings`: the people, their goals, the team goal, the board message

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
