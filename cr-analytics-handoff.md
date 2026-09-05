# CR Analytics — Project Handoff Document

## What This Is

CR Analytics (`cr-analytics.vercel.app`) is a scouting and match analytics dashboard for FRC Team 1002 — CircuitRunners Robotics, Wheeler High School, Marietta, GA. Built and maintained by Todd Anderson.

It operates in two modes:
- **PCH District Mode** — 2026 Peachtree District season analytics for all Georgia/PCH teams
- **Houston Championship Mode** — dedicated dashboard for the 2026 FIRST Championship, Johnson Division

---

## Repository & Deployment

| Item | Value |
|---|---|
| GitHub | `github.com/tmanders10/cr-analytics` |
| Live URL | `cr-analytics.vercel.app` |
| Deployment | Vercel (auto-deploys on push to `main`) |
| Stack | Vanilla HTML/JS/CSS — no framework, no build step |
| Data | JSON files in `public/` served as static assets |

**There is no Supabase on this project.** Data is stored as flat JSON files committed to GitHub.

---

## File Structure

```
api/
  refresh.js                  ← PCH full refresh (Vercel serverless)
  refresh-matches.js          ← PCH match update (Vercel serverless)
  refresh-houston-matches.js  ← Houston match update (Vercel serverless)
public/
  index.html                  ← Entire app (single file)
  guide.html                  ← User guide
  data.json                   ← PCH district data
  houston.json                ← Houston championship data
  logo.png
scripts/
  refresh-data.js             ← PCH full refresh (local, no timeout)
  refresh-houston.js          ← Houston full refresh (local, no timeout)
vercel.json                   ← Vercel config
package.json
```

---

## Data Architecture

### PCH — `public/data.json`
Built by running `scripts/refresh-data.js` or triggering `api/refresh.js` via the Full Refresh button. Structure:
```
{
  fetchedAt, teams[], events{}, alliances{}, distRank[],
  epa{frcXXXX: {evKey: {total,auto,teleop,endgame,sd,norm}}},
  ace{teamNum: {ace,raw,confidence,rank_state,rank_district,...}},
  matchPreds{matchKey: {winner,prob}}
}
```

### Houston — `public/houston.json`
Built by running `scripts/refresh-houston.js` locally (5 steps). Structure:
```
{
  division, divisionEventKey, fetchedAt, teams[],
  events{}, teamEventKeys{},
  epa{frcXXXX: {evKey: {total,auto,teleop,endgame,sd,norm}}},
  ace{teamNum: {ace,raw,confidence,auto_raw,teleop_raw,endgame_raw,rank_global,...}},
  sbRanks{teamNum: {rank_global,rank_country,country,record,epa_total,epa_auto,epa_teleop,epa_endgame}},
  divisionEvent{matches[],rankings{}},
  matchPreds{}
}
```

---

## Environment Variables (Vercel)

Set under: Vercel Dashboard → cr-analytics → Settings → Environment Variables

| Variable | Purpose |
|---|---|
| `TBA_KEY` | The Blue Alliance API key |
| `GITHUB_TOKEN` | GitHub personal access token (for committing JSON files) |
| `GITHUB_REPO` | `tmanders10/cr-analytics` |
| `PEEKOROBO_API_KEY` | Peekorobo ACE data API key |
| `HOUSTON_DIVISION` | `Johnson` |
| `HOUSTON_DIVISION_EVENT_KEY` | `2026joh` |

---

## Running the Houston Refresh Script

From your desktop in the project root:

```bash
# Full refresh (all 5 steps) — takes ~30-45 min
node scripts/refresh-houston.js TBA_KEY=xxx GITHUB_TOKEN=xxx GITHUB_REPO=tmanders10/cr-analytics PEEKOROBO_API_KEY=xxx

# Partial refresh (specific steps only)
node scripts/refresh-houston.js TBA_KEY=xxx GITHUB_TOKEN=xxx GITHUB_REPO=tmanders10/cr-analytics PEEKOROBO_API_KEY=xxx STEPS=3

# Steps:
# 1 — Find most recent qualifying 2026 event per team (TBA) — checks match counts, picks event with 10+ matches
# 2 — Fetch match/ranking/OPR data for each unique event (TBA)
# 3 — Statbotics EPA + global/US rankings per team (team_years endpoint)
# 4 — Peekorobo ACE per team
# 5 — Division event matches/rankings (requires HOUSTON_DIVISION_EVENT_KEY)
```

Partial runs load existing `houston.json` from GitHub first and only overwrite the sections for the steps run.

---

## Data Sources

| Column/Feature | Source | Endpoint |
|---|---|---|
| Global Rank | Statbotics | `/team_years?team=X&year=2026` → `epa.ranks.total.rank` |
| US Rank | Statbotics | same → `epa.ranks.country.rank` |
| EPA (Total/Auto/Teleop/Endgame) | Statbotics | same → `epa.total_points.mean`, `epa.breakdown.*` |
| Season W/L/T record | Statbotics | same → `record.wins/losses/ties` |
| OPR | TBA | `/event/{key}/oprs` |
| Match data | TBA | `/event/{key}/matches` |
| ACE + phase breakdown | Peekorobo | `/team/{num}/perfs/2026` |
| Match predictions | Statbotics | `/matches?event={key}` |
| Division matches (live) | TBA via Vercel | `/event/2026joh/matches` |

---

## Mode Switching

- **Default mode**: Houston (Championship) on page load
- **Toggle**: `⚡ Houston` / `← Peachtree` button in header, or `Ctrl+Shift+H`
- **Force PCH via URL**: `?pch=1`
- **Tracked teams**: cleared automatically when switching modes

---

## Houston Mode — Key Features

### Tabs (Houston mode)
1. **Overview** — Live stream (date-based, Apr 29–May 2), division banner, 1002 PCH record card, Top 5 EPA, tracked teams comparison chart
2. **Global Rankings** — All 75 teams, sortable, Statbotics ranks, Peekorobo ACE
3. **Scoring Analysis** — Top 20 matches by score, both alliances shown, tracked team highlighting
4. **Team Tracker** — Up to 9 teams, team cards with season record + last event stats + EPA breakdown
5. **Match History** — Pre-event match data for tracked teams (sorted: Johnson matches first, then last event)
6. **Johnson Matches** — Full division schedule, filter by team #, Match Track button
7. **Johnson Standings** — Live division rankings

### Match Track Feature
- Click **Match Track** on any match row (Johnson Matches tab or PCH Match Log)
- Clears all tracked teams, loads red alliance (slots 1-3) then blue alliance (slots 4-6)
- Team cards show **Red Alliance** / **Blue Alliance** badge
- Click **★ Tracking** on active row to clear
- Manually removing any team clears Match Track mode
- Filter persists when clicking Match Track

### Livestreams (Overview tab)
Automatically loads day-specific YouTube stream during Apr 29–May 2:
- Apr 29 (Wed): `PqyFF_0QMTE`
- Apr 30 (Thu): `KTlZmUXbwfA`
- May 1 (Fri): `skZTO76_SB4`
- May 2 (Sat): `_6BhNlBWvw4`

Override with pencil ✎ button (saves to sessionStorage).

### Match Update Button
During the event, clicking **Match Update** calls `api/refresh-houston-matches.js` which fetches division matches, rankings, and Statbotics predictions — preserving all other `houston.json` data. Requires `HOUSTON_DIVISION_EVENT_KEY` set in Vercel env vars.

---

## PCH Mode — Key Features

- Full 2026 PCH district season: 6 events (DAL, GWI, COL, ALB, GAI, CMP)
- Congratulatory banner showing 44W-10L-1T, #4 seed, 2 event championships (Dalton + Albany)
- PCH data sourced from `public/data.json`
- Match Log includes Match Track button (same behavior as Houston)
- Full Refresh button → `api/refresh.js` (Vercel, ~30 sec)
- Match Update button → `api/refresh-matches.js` (Vercel, ~5 sec, active event only)

---

## Johnson Division Teams (75 teams)

Team numbers in `scripts/refresh-houston.js` `HOUSTON_TEAMS` array. Notable teams:
- **1002** — CircuitRunners Robotics (Marietta, GA) — our team
- **9483** — Overcharge (Istanbul, Turkey) — Global #1
- **4946** — The Alpha Dogs (Bolton, Ontario, Canada) — Global #17
- **498** — The Cobra Commanders (Glendale, AZ) — Global #23
- **118** — Robonauts (Houston, TX) — host team

---

## Known Technical Notes

- `index.html` is the entire app — ~750KB single file, all JS/CSS inline
- No npm build step — edit directly in GitHub web editor or locally
- `guide.html` is a two-tab user guide (Peachtree District / FIRST Championship)
- The guide and app are linked via `/guide.html` relative path
- Vercel auto-redeploys within ~60s of any commit to `main`
- `public/data.json` and `public/houston.json` are committed by the refresh scripts via GitHub API — no manual upload needed
- After changing Vercel env vars, a redeploy is needed for serverless functions to pick them up (push any small commit, or use Vercel dashboard redeploy)

---

## Continuing Development — Prompt Tips for Claude

Start new conversations with this context block:

```
I'm working on CR Analytics — an FRC scouting dashboard for Team 1002 
(CircuitRunners Robotics, Wheeler HS, Marietta GA).

GitHub: github.com/tmanders10/cr-analytics
Live: cr-analytics.vercel.app
Stack: Single-file vanilla HTML/JS/CSS, Vercel deployment, JSON data files

The app has two modes:
- PCH District mode (data.json) 
- Houston Championship mode (houston.json, Johnson Division, 2026joh)

I'll paste the relevant section of index.html when I need code changes.
```

Always paste the specific function or section you want changed — the file is large and Claude works best with the exact code in context.

---

*Document generated April 29, 2026 from active development session.*
