#!/usr/bin/env node
/**
 * CR Analytics — scripts/refresh-houston.js
 * ------------------------------------------
 * Local script (no Vercel timeout) to build houston.json for Houston Championship mode.
 * Run from the cr-analytics project root:
 *
 *   node scripts/refresh-houston.js \
 *     TBA_KEY=your_key \
 *     GITHUB_TOKEN=your_token \
 *     GITHUB_REPO=tmanders10/cr-analytics \
 *     PEEKOROBO_API_KEY=your_key \
 *     HOUSTON_DIVISION="Archimedes" \
 *     HOUSTON_DIVISION_EVENT_KEY=2026txcmparch
 *
 * OPTIONAL — run only specific steps (comma-separated, default: all):
 *     STEPS=4                      (ACE only)
 *     STEPS=1,2,3                  (TBA data only, skip ACE and division)
 *     STEPS=1,2,3,4,5              (all steps — same as default)
 *
 * Steps:
 *   1 — Find most recent 2026 event per team (TBA)
 *   2 — Fetch match/ranking/OPR data for each unique event (TBA)
 *   3 — Statbotics EPA + global/US rankings per team
 *   4 — Peekorobo ACE per team
 *   5 — Division event data (requires HOUSTON_DIVISION_EVENT_KEY)
 *
 * When running a subset of steps, existing houston.json is loaded from GitHub
 * first so unchanged data is preserved.
 */

'use strict';

const https = require('https');
const http  = require('http');

// ── Parse args (KEY=value pairs) ──────────────────────────────────────────────
const env = {};
process.argv.slice(2).forEach(arg => {
  const idx = arg.indexOf('=');
  if (idx > -1) env[arg.slice(0, idx)] = arg.slice(idx + 1);
});

const TBA_KEY           = env.TBA_KEY           || process.env.TBA_KEY;
const GITHUB_TOKEN      = env.GITHUB_TOKEN      || process.env.GITHUB_TOKEN;
const GITHUB_REPO       = env.GITHUB_REPO       || process.env.GITHUB_REPO;
const PEEKOROBO_KEY     = env.PEEKOROBO_API_KEY || process.env.PEEKOROBO_API_KEY;
const DIVISION          = env.HOUSTON_DIVISION  || process.env.HOUSTON_DIVISION  || 'Johnson';
const DIV_EVENT_KEY     = env.HOUSTON_DIVISION_EVENT_KEY || process.env.HOUSTON_DIVISION_EVENT_KEY || '2026joh';

// ── Steps to run (default: all) ───────────────────────────────────────────────
const STEPS_RAW = env.STEPS || process.env.STEPS || 'all';
const RUN_ALL   = STEPS_RAW === 'all';
const STEPS     = RUN_ALL
  ? new Set([1, 2, 3, 4, 5])
  : new Set(STEPS_RAW.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)));
const PARTIAL   = !RUN_ALL; // partial run = load existing data first

if (!TBA_KEY)      { console.error('ERROR: TBA_KEY is required'); process.exit(1); }
if (!GITHUB_TOKEN) { console.error('ERROR: GITHUB_TOKEN is required'); process.exit(1); }
if (!GITHUB_REPO)  { console.error('ERROR: GITHUB_REPO is required'); process.exit(1); }

// ── Team list ─────────────────────────────────────────────────────────────────
const HOUSTON_TEAMS = [
  { num:     8, name: 'Paly Robotics', location: 'Palo Alto, California' },
  { num:    33, name: 'Killer Bees', location: 'Bloomfield Hills, Michigan' },
  { num:    48, name: 'Team E.L.I.T.E.', location: 'Warren, Ohio' },
  { num:    67, name: 'The HOT Team', location: 'Highland, Michigan' },
  { num:   117, name: 'Steel Dragons', location: 'Pittsburgh, Pennsylvania' },
  { num:   118, name: 'Robonauts', location: 'Houston, Texas' },
  { num:   179, name: 'Children of the Swamp', location: 'Riviera Beach, Florida' },
  { num:   190, name: 'Gompei and the HERD', location: 'Worcester, Massachusetts' },
  { num:   245, name: 'Adambots', location: 'Rochester Hills, Michigan' },
  { num:   321, name: 'RoboLancers', location: 'Philadelphia, Pennsylvania' },
  { num:   334, name: 'TechKnights', location: 'Brooklyn, New York' },
  { num:   360, name: 'The Revolution', location: 'Tacoma, Washington' },
  { num:   422, name: 'The Mech Tech Dragons', location: 'Richmond, Virginia' },
  { num:   498, name: 'The Cobra Commanders', location: 'Glendale, Arizona' },
  { num:   619, name: 'Cavalier Robotics', location: 'Charlottesville, Virginia' },
  { num:   772, name: 'Sabre Bytes Robotics', location: 'LaSalle, Ontario, Canada' },
  { num:   836, name: 'The RoboBees', location: 'Hollywood, Maryland' },
  { num:   955, name: 'Ctrl C', location: 'Corvallis, Oregon' },
  { num:  1002, name: 'CircuitRunners Robotics', location: 'Marietta, Georgia' },
  { num:  1073, name: 'The Force Team', location: 'Hollis, New Hampshire' },
  { num:  1076, name: 'PiHi Samurai', location: 'Ann Arbor, Michigan' },
  { num:  1306, name: 'BadgerBOTS', location: 'Middleton, Wisconsin' },
  { num:  1792, name: 'Round Table Robotics', location: 'Oak Creek, Wisconsin' },
  { num:  1908, name: 'ShoreBots', location: 'Eastville, Virginia' },
  { num:  2040, name: 'DERT - Dunlap Eagles Robotics Team', location: 'Dunlap, Illinois' },
  { num:  2096, name: 'RoboActive', location: 'Dimona, HaDarom, Israel' },
  { num:  2252, name: 'The Mavericks', location: 'Milan, Ohio' },
  { num:  2337, name: 'EngiNERDs', location: 'Grand Blanc, Michigan' },
  { num:  2522, name: 'Royal Robotics', location: 'Bothell, Washington' },
  { num:  2619, name: 'The Charge', location: 'Midland, Michigan' },
  { num:  2638, name: 'Rebel Robotics', location: 'Great Neck, New York' },
  { num:  2704, name: 'Roaring Robotics', location: 'Naperville, Illinois' },
  { num:  2848, name: 'Rangers', location: 'Dallas, Texas' },
  { num:  2877, name: 'LigerBots', location: 'Newtonville, Massachusetts' },
  { num:  3061, name: 'Huskie Robotics', location: 'Naperville, Illinois' },
  { num:  3255, name: 'SuperNURDs', location: 'Escondido, California' },
  { num:  3414, name: 'Hackbots', location: 'Farmington, Michigan' },
  { num:  3536, name: 'Electro Eagles', location: 'Hartland, Michigan' },
  { num:  3603, name: 'Cyber Coyotes', location: 'Reed City, Michigan' },
  { num:  3620, name: 'Average Joes', location: 'Saint Joseph, Michigan' },
  { num:  3630, name: 'Stampede', location: 'Minneapolis, Minnesota' },
  { num:  3770, name: 'BlitzCreek', location: 'Midland, Michigan' },
  { num:  4391, name: 'BraveBots', location: 'Gladstone, Michigan' },
  { num:  4451, name: 'ROBOTZ Garage', location: 'Laurens, South Carolina' },
  { num:  4522, name: 'Team SCREAM', location: 'Sedalia, Missouri' },
  { num:  4635, name: 'PrepaTec - Botbusters', location: 'Monterrey, Nuevo Leon, Mexico' },
  { num:  4946, name: 'The Alpha Dogs', location: 'Bolton, Ontario, Canada' },
  { num:  4967, name: 'That ONE Team-OurNextEngineers', location: 'Belmont, Michigan' },
  { num:  5026, name: 'Iron Panthers', location: 'Burlingame, California' },
  { num:  5968, name: 'Little Apple Cyborgs', location: 'Manhattan, Kansas' },
  { num:  6324, name: 'The Blue Devils', location: 'Salem, New Hampshire' },
  { num:  6652, name: 'Tigres', location: 'San Nicolas de los Garza, Nuevo Leon, Mexico' },
  { num:  6766, name: 'AtomStorm', location: 'Shenzhen, Guangdong, China' },
  { num:  6829, name: 'Ignite Robotics', location: 'Suwanee, Georgia' },
  { num:  6940, name: 'Violet Z', location: 'Shanghai, Shanghai, China' },
  { num:  7220, name: 'Steel Falcons', location: 'Brighton, Michigan' },
  { num:  7257, name: 'Semiconductors', location: 'Sauk Centre, Minnesota' },
  { num:  7403, name: 'Lightning Blue Lizards', location: 'Envigado, Antioquia, Colombia' },
  { num:  7551, name: 'Extreme Mechanism', location: 'Zhuqi, Chiayi, Chinese Taipei' },
  { num:  7558, name: 'ALT-F4', location: 'North York, Ontario, Canada' },
  { num:  7563, name: 'SESI SENAI MEGAZORD', location: 'Jundiai, Sao Paulo, Brazil' },
  { num:  8612, name: 'Calvin Christian Robotics', location: 'Grandville, Michigan' },
  { num:  9072, name: 'TigerBots', location: 'Hanover, Maryland' },
  { num:  9277, name: 'Sparkans', location: 'Calgary, Alberta, Canada' },
  { num:  9483, name: 'Overcharge', location: 'Cekmekoy, Istanbul, Turkiye' },
  { num:  9484, name: 'Robot\'s District', location: 'Taguatinga, Distrito Federal, Brazil' },
  { num:  9597, name: 'Luban Robotics', location: 'Beijing, Beijing, China' },
  { num:  9646, name: 'The Marinators', location: 'Southampton, New York' },
  { num:  9757, name: 'Mecha Marauders', location: 'Marlette, Michigan' },
  { num: 10014, name: 'REBELLION', location: 'Prosper, Texas' },
  { num: 10114, name: 'Phantom Talons', location: 'Zhonghe Dist, New Taipei, Chinese Taipei' },
  { num: 10217, name: 'Catahoula Blue Dogs', location: 'Port Allen, Louisiana' },
  { num: 10340, name: 'ITKAN Girls', location: 'Plano, Texas' },
  { num: 10396, name: 'Mostra', location: 'Istanbul, Istanbul, Turkiye' },
  { num: 11269, name: 'Batteries Not Included', location: 'South Burlington, Vermont' },
];
// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg)  { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toISOString().slice(11,19)}] ⚠  ${msg}`); }
function ok(msg)   { console.log(`[${new Date().toISOString().slice(11,19)}] ✓  ${msg}`); }

function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'cr-analytics-local', ...headers } }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode === 404) { resolve(null); return; }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON parse failed for ${url}: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

function tbaFetch(path) {
  return fetchJSON(`https://www.thebluealliance.com/api/v3${path}`, { 'X-TBA-Auth-Key': TBA_KEY });
}

function statboticsFetch(path) {
  return fetchJSON(`https://api.statbotics.io/v3${path}`, { 'Accept': 'application/json' });
}

// ── Data shaping (identical to Vercel script) ─────────────────────────────────
function extractEPA(record) {
  if (!record?.epa) return null;
  const e = record.epa;
  const bd = e.breakdown || {};
  return {
    total:   e.total_points?.mean ?? null,
    auto:    bd.auto_points       ?? null,
    teleop:  bd.teleop_points     ?? null,
    endgame: bd.endgame_points    ?? null,
    sd:      e.total_points?.sd   ?? null,
    norm:    e.norm               ?? null,
  };
}









// ── GitHub helpers ────────────────────────────────────────────────────────────
async function getFileSHA(path) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  const data = await fetchJSON(url, {
    Authorization: `token ${GITHUB_TOKEN}`,
  }).catch(() => null);
  return data?.sha || null;
}

async function commitFile(path, jsonObj, message) {
  const content = Buffer.from(JSON.stringify(jsonObj)).toString('base64');
  const sha = await getFileSHA(path);
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ message, content, ...(sha ? { sha } : {}) });
    const options = {
      hostname: 'api.github.com',
      path:     `/repos/${GITHUB_REPO}/contents/${path}`,
      method:   'PUT',
      headers: {
        Authorization:  `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent':   'cr-analytics-local',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) { resolve(); return; }
        try { const e = JSON.parse(data); reject(new Error(`GitHub ${res.statusCode}: ${e.message}`)); }
        catch { reject(new Error(`GitHub ${res.statusCode}: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  console.log('');
  console.log('================================================');
  console.log('  CR Analytics — Houston Data Refresh (Local)  ');
  console.log('================================================');
  console.log(`  Teams:    ${HOUSTON_TEAMS.length}`);
  console.log(`  Division: ${DIVISION}`);
  console.log(`  Div Key:  ${DIV_EVENT_KEY || '(not set — prototyping mode)'}`);
  console.log(`  Repo:     ${GITHUB_REPO}`);
  console.log(`  Steps:    ${RUN_ALL ? 'All (1-5)' : [...STEPS].sort().join(', ')}`);
  console.log('================================================');
  console.log('');

  // ── Load existing houston.json for partial runs ───────────────────────────
  let existing = {
    division:         DIVISION,
    divisionEventKey: DIV_EVENT_KEY,
    teams:            HOUSTON_TEAMS,
    events:           {},
    teamEventKeys:    {},
    epa:              {},
    ace:              {},
    divisionEvent:    {},
    matchPreds:       {},
  };

  if (PARTIAL) {
    log('Partial run — loading existing houston.json from GitHub to preserve unchanged data...');
    try {
      const metaRes = await fetchJSON(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/public/houston.json`,
        { Authorization: `token ${GITHUB_TOKEN}` }
      );
      if (metaRes && metaRes.sha) {
        let decoded;
        if (metaRes.content && metaRes.encoding === 'base64' && metaRes.size < 900000) {
          decoded = Buffer.from(metaRes.content.replace(/\n/g, ''), 'base64').toString('utf8');
        } else {
          decoded = await fetchJSON(
            `https://api.github.com/repos/${GITHUB_REPO}/git/blobs/${metaRes.sha}`,
            { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3.raw' }
          );
          if (typeof decoded === 'object') decoded = JSON.stringify(decoded);
        }
        if (decoded) {
          existing = typeof decoded === 'string' ? JSON.parse(decoded) : decoded;
          ok(`Loaded existing houston.json (${Object.keys(existing.events||{}).length} events, ${Object.keys(existing.ace||{}).length} ACE records)`);
        }
      }
    } catch (e) {
      warn(`Could not load existing houston.json: ${e.message} — starting fresh`);
    }
    console.log('');
  }

  const output = {
    division:         DIVISION,
    divisionEventKey: DIV_EVENT_KEY,
    fetchedAt:        new Date().toISOString(),
    teams:            HOUSTON_TEAMS,
    // Seed from existing — steps will overwrite what they process
    events:           { ...existing.events },
    teamEventKeys:    { ...existing.teamEventKeys },
    epa:              { ...existing.epa },
    ace:              { ...existing.ace },
    sbRanks:          { ...existing.sbRanks },
    divisionEvent:    { ...existing.divisionEvent },
    matchPreds:       { ...existing.matchPreds },
  };

  // ── STEP 1: Find most recent 2026 event per team ───────────────────────────
  const teamEventMap = {};
  if (!STEPS.has(1)) { console.log('STEP 1/5 — Skipped'); }
  else { console.log(`STEP 1/5 — Finding most recent 2026 event for each team...`);

  for (let i = 0; i < HOUSTON_TEAMS.length; i++) {
    const team = HOUSTON_TEAMS[i];
    const teamKey = `frc${team.num}`;
    output.teamEventKeys[team.num] = [];
    output.epa[teamKey] = {};

    try {
      const events = await tbaFetch(`/team/${teamKey}/events/2026/simple`);
      const regEvents = (events || [])
        .filter(ev => ev.event_type !== 3 && ev.event_type !== 4)
        .sort((a, b) => {
          // Prioritize District CMP (type 2) and District CMP Division (type 6) over regular events
          const aScore = (a.event_type === 2 || a.event_type === 6) ? 1000 + (a.week ?? 0) : (a.week ?? 0);
          const bScore = (b.event_type === 2 || b.event_type === 6) ? 1000 + (b.week ?? 0) : (b.week ?? 0);
          return bScore - aScore;
        });
      const mostRecent = regEvents[0] || null;
      if (mostRecent) {
        teamEventMap[team.num] = mostRecent;
        output.teamEventKeys[team.num] = [mostRecent.key];
        process.stdout.write(`  [${i+1}/${HOUSTON_TEAMS.length}] ${teamKey} → ${mostRecent.key}\n`);
      } else {
        warn(`No 2026 events found for ${teamKey}`);
      }
    } catch (e) {
      warn(`Events fetch failed for ${teamKey}: ${e.message}`);
    }

    // Polite pacing — 200ms every 5 teams
    if ((i + 1) % 5 === 0) await sleep(200);
  }

  ok(`Step 1 complete — ${Object.keys(teamEventMap).length} teams mapped to ${new Set(Object.values(teamEventMap).map(ev=>ev.key)).size} unique events`);
  } // end STEP 1
  console.log('');

  // ── STEP 2: Fetch each unique event ONCE ──────────────────────────────────
  const uniqueEventKeys = STEPS.has(1)
    ? [...new Set(Object.values(teamEventMap).map(ev => ev.key))]
    : Object.keys(output.events);
  if (!STEPS.has(2)) { console.log('STEP 2/5 — Skipped'); }
  else { console.log(`STEP 2/5 — Fetching match/ranking/OPR data for ${uniqueEventKeys.length} unique events...`);

  for (let i = 0; i < uniqueEventKeys.length; i++) {
    const evKey = uniqueEventKeys[i];
    const evMeta = Object.values(teamEventMap).find(ev => ev.key === evKey);
    process.stdout.write(`  [${i+1}/${uniqueEventKeys.length}] ${evKey} ...`);
    try {
      const [matches, rankings, oprs] = await Promise.all([
        tbaFetch(`/event/${evKey}/matches`).catch(() => []),
        tbaFetch(`/event/${evKey}/rankings`).catch(() => ({})),
        tbaFetch(`/event/${evKey}/oprs`).catch(() => ({})),
      ]);
      output.events[evKey] = {
        eventName: evMeta?.short_name || evMeta?.name || evKey,
        week:      evMeta?.week ?? 0,
        matches:   matches || [],
        rankings:  rankings || {},
        oprs:      oprs || {},
      };
      process.stdout.write(` ${(matches||[]).length} matches\n`);
    } catch (e) {
      process.stdout.write(` FAILED: ${e.message}\n`);
    }
    await sleep(150);
  }

  ok(`Step 2 complete — ${Object.keys(output.events).length} events loaded`);
  } // end STEP 2
  console.log('');

  // ── STEP 3: Statbotics EPA + Season Rankings ────────────────────────────────
  if (!STEPS.has(3)) { console.log('STEP 3/5 — Skipped'); }
  else { console.log(`STEP 3/5 — Fetching Statbotics EPA + rankings for ${HOUSTON_TEAMS.length} teams...`);

  for (let i = 0; i < HOUSTON_TEAMS.length; i++) {
    const team = HOUSTON_TEAMS[i];
    const teamKey = `frc${team.num}`;
    try {
      // Fetch per-event EPA data
      const records = await statboticsFetch(`/team_events?team=${team.num}&year=2026&limit=20`);
      if (Array.isArray(records)) {
        records.forEach(record => {
          const epa = extractEPA(record);
          if (epa && record.event) output.epa[teamKey][record.event] = epa;
        });
        const epaCount = Object.keys(output.epa[teamKey]).length;
        if (epaCount > 0) process.stdout.write(`  [${i+1}/${HOUSTON_TEAMS.length}] ${teamKey} — ${epaCount} EPA record(s)`);
        else              process.stdout.write(`  [${i+1}/${HOUSTON_TEAMS.length}] ${teamKey} — no EPA data yet`);
      }
    } catch (e) {
      warn(`Statbotics EPA failed for team ${team.num}: ${e.message}`);
    }
    await sleep(80);

    // Fetch season-level team_years for global/US ranks
    try {
      const teamYears = await statboticsFetch(`/team_years?team=${team.num}&year=2026&limit=1`);
      const teamYear = Array.isArray(teamYears) ? teamYears[0] : null;
      if (teamYear && teamYear.epa?.ranks) {
        const ranks = teamYear.epa.ranks;
        if (!output.sbRanks) output.sbRanks = {};
        output.sbRanks[team.num] = {
          rank_global:        ranks.total?.rank        ?? null,
          rank_country:       ranks.country?.rank      ?? null,
          total_teams_global: ranks.total?.team_count  ?? null,
          total_teams_country:ranks.country?.team_count?? null,
          country:            teamYear.country         ?? null,
        };
        process.stdout.write(` | Global #${ranks.total?.rank ?? '?'} US #${ranks.country?.rank ?? 'N/A'}\n`);
      } else {
        process.stdout.write('\n');
      }
    } catch (e) {
      process.stdout.write('\n');
      warn(`Statbotics team_years failed for team ${team.num}: ${e.message}`);
    }
    await sleep(80);
  }

  ok('Step 3 complete');
  } // end STEP 3
  console.log('');

  // ── STEP 4: Peekorobo ACE ─────────────────────────────────────────────────
  if (!STEPS.has(4)) { console.log('STEP 4/5 — Skipped'); }
  else if (PEEKOROBO_KEY) { console.log(`STEP 4/5 — Fetching Peekorobo ACE for ${HOUSTON_TEAMS.length} teams...`);
    for (let i = 0; i < HOUSTON_TEAMS.length; i++) {
      const team = HOUSTON_TEAMS[i];
      try {
        const data = await fetchJSON(
          `https://www.peekorobo.com/api/team_perfs/${team.num}`,
          { 'X-Api-Key': PEEKOROBO_KEY }
        );
        const perfs = (data?.team_perfs || []).find(p => p.year === 2026) || null;
        if (perfs) {
          output.ace[team.num] = {
            ace:            perfs.ace            ?? null,
            raw:            perfs.raw            ?? null,
            confidence:     perfs.confidence     ?? null,
            auto_raw:       perfs.auto_raw       ?? null,
            teleop_raw:     perfs.teleop_raw     ?? null,
            endgame_raw:    perfs.endgame_raw    ?? null,
            rank_global:    perfs.rank_global    ?? null,
            rank_country:   perfs.rank_country   ?? null,
            rank_state:     perfs.rank_state     ?? null,
            rank_district:  perfs.rank_district  ?? null,
            count_global:   perfs.count_global   ?? null,
            count_country:  perfs.count_country  ?? null,
            count_state:    perfs.count_state    ?? null,
            count_district: perfs.count_district ?? null,
            event_perfs:    perfs.event_perf     ?? [],
          };
          process.stdout.write(`  [${i+1}/${HOUSTON_TEAMS.length}] frc${team.num} — ACE ${perfs.ace?.toFixed(1) ?? 'n/a'}\n`);
        } else {
          process.stdout.write(`  [${i+1}/${HOUSTON_TEAMS.length}] frc${team.num} — no ACE data\n`);
        }
      } catch (e) {
        warn(`ACE failed for team ${team.num}: ${e.message}`);
      }
      await sleep(100);
    }
    ok('Step 4 complete');
  } else if (STEPS.has(4)) {
    console.log('STEP 4/5 — Skipping Peekorobo ACE (no PEEKOROBO_API_KEY provided)');
  }
  console.log('');

  // ── STEP 5: Division event (if key is set) ────────────────────────────────
  if (!STEPS.has(5)) { console.log('STEP 5/5 — Skipped'); }
  else if (DIV_EVENT_KEY) {
    console.log(`STEP 5/5 — Fetching division event data for ${DIV_EVENT_KEY}...`);
    try {
      const [matches, rankings, alliances] = await Promise.all([
        tbaFetch(`/event/${DIV_EVENT_KEY}/matches`).catch(() => []),
        tbaFetch(`/event/${DIV_EVENT_KEY}/rankings`).catch(() => ({})),
        tbaFetch(`/event/${DIV_EVENT_KEY}/alliances`).catch(() => []),
      ]);
      output.divisionEvent = {
        matches:   matches || [],
        rankings:  rankings || {},
        alliances: alliances || [],
      };
      log(`Division matches: ${(matches||[]).length}`);

      try {
        const sbMatches = await statboticsFetch(`/matches?event=${DIV_EVENT_KEY}&limit=200`);
        if (Array.isArray(sbMatches)) {
          sbMatches.forEach(m => {
            if (!m.key || !m.pred) return;
            const winner = m.pred.winner      ?? null;
            const prob   = m.pred.red_win_prob ?? null;
            if (winner !== null && prob !== null) output.matchPreds[m.key] = { winner, prob };
          });
          log(`Match predictions loaded: ${Object.keys(output.matchPreds).length}`);
        }
      } catch (e) { warn(`Statbotics preds failed: ${e.message}`); }
    } catch (e) { warn(`Division event fetch failed: ${e.message}`); }
    ok('Step 5 complete');
  } else if (STEPS.has(5)) {
    console.log('STEP 5/5 — Skipping division event (HOUSTON_DIVISION_EVENT_KEY not set)');
  }
  console.log('');

  // ── COMMIT to GitHub ───────────────────────────────────────────────────────
  const sizeBytes = JSON.stringify(output).length;
  console.log(`Committing houston.json to GitHub...`);
  console.log(`  File size: ${(sizeBytes / 1024).toFixed(1)} KB`);

  try {
    log('Writing public/houston.json ...');
    await commitFile('public/houston.json', output, `chore: houston refresh ${output.fetchedAt}`);
    ok('public/houston.json committed');
  } catch (e) {
    console.error(`\nERROR committing to GitHub: ${e.message}`);
    process.exit(1);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalMatches = Object.values(output.events).reduce((s, ev) => s + (ev.matches?.length || 0), 0);

  console.log('');
  console.log('================================================');
  console.log('  DONE ✓');
  console.log('================================================');
  console.log(`  Elapsed:       ${elapsed}s`);
  console.log(`  Teams:         ${HOUSTON_TEAMS.length}`);
  console.log(`  Unique events: ${Object.keys(output.events).length}`);
  console.log(`  Total matches: ${totalMatches}`);
  console.log(`  EPA records:   ${Object.values(output.epa).reduce((s,e) => s + Object.keys(e).length, 0)}`);
  console.log(`  ACE records:   ${Object.keys(output.ace).length}`);
  console.log(`  File size:     ${(sizeBytes / 1024).toFixed(1)} KB`);
  console.log('================================================');
  console.log('');
  console.log('Vercel will redeploy automatically. Houston mode');
  console.log('should be live at cr-analytics.vercel.app in ~60s.');
  console.log('');
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err.message);
  process.exit(1);
});
