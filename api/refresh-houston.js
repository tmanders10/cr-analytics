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
 *   3 — Statbotics EPA per team
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
const DIVISION          = env.HOUSTON_DIVISION  || process.env.HOUSTON_DIVISION  || 'Division TBD';
const DIV_EVENT_KEY     = env.HOUSTON_DIVISION_EVENT_KEY || process.env.HOUSTON_DIVISION_EVENT_KEY || '';

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
  { num: 16,   name: 'Bomb Squad',                         location: 'Mountain Home, Arkansas, USA' },
  { num: 48,   name: 'Team E.L.I.T.E.',                    location: 'Warren, Ohio, USA' },
  { num: 59,   name: 'RamTech',                             location: 'Miami, Florida, USA' },
  { num: 111,  name: 'WildStang',                           location: 'Arlington Heights, Illinois, USA' },
  { num: 117,  name: 'Steel Dragons',                       location: 'Pittsburgh, Pennsylvania, USA' },
  { num: 167,  name: 'Children of the Corn',                location: 'Iowa City, Iowa, USA' },
  { num: 179,  name: 'Children of the Swamp',               location: 'Riviera Beach, Florida, USA' },
  { num: 180,  name: 'S.P.A.M.',                            location: 'Stuart, Florida, USA' },
  { num: 254,  name: 'The Cheesy Poofs',                    location: 'San Jose, California, USA' },
  { num: 287,  name: 'Floyd Robotics',                      location: 'Mastic Beach, New York, USA' },
  { num: 321,  name: 'RoboLancers',                         location: 'Philadelphia, Pennsylvania, USA' },
  { num: 340,  name: 'G.R.R. (Greater Rochester Robotics)', location: 'Churchville, New York, USA' },
  { num: 343,  name: 'Metal-In-Motion',                     location: 'Seneca, South Carolina, USA' },
  { num: 346,  name: 'RoboHawks',                           location: 'Richmond, Virginia, USA' },
  { num: 359,  name: 'Hawaiian Kids',                       location: 'Waialua, Hawaii, USA' },
  { num: 360,  name: 'The Revolution',                      location: 'Tacoma, Washington, USA' },
  { num: 401,  name: 'Copperhead Robotics',                 location: 'Blacksburg, Virginia, USA' },
  { num: 424,  name: 'Rust Belt Robotics',                  location: 'Buffalo, New York, USA' },
  { num: 449,  name: 'The Blair Robot Project',             location: 'Silver Spring, Maryland, USA' },
  { num: 498,  name: 'The Cobra Commanders',                location: 'Glendale, Arizona, USA' },
  { num: 503,  name: 'Frog Force',                          location: 'Novi, Michigan, USA' },
  { num: 581,  name: 'Blazing Bulldogs',                    location: 'San Jose, California, USA' },
  { num: 587,  name: 'The Hedgehogs',                       location: 'Hillsborough, North Carolina, USA' },
  { num: 599,  name: 'The Robodox',                         location: 'Granada Hills, California, USA' },
  { num: 614,  name: 'Night Hawks',                         location: 'Alexandria, Virginia, USA' },
  { num: 687,  name: 'The Nerd Herd',                       location: 'Carson, California, USA' },
  { num: 694,  name: 'StuyPulse',                           location: 'New York, New York, USA' },
  { num: 695,  name: 'Bison Robotics',                      location: 'Beachwood, Ohio, USA' },
  { num: 836,  name: 'The RoboBees',                        location: 'Hollywood, Maryland, USA' },
  { num: 870,  name: 'TEAM R. I. C. E.',                    location: 'Southold, New York, USA' },
  { num: 948,  name: 'NRG (Newport Robotics Group)',         location: 'Bellevue, Washington, USA' },
  { num: 955,  name: 'Ctrl C',                              location: 'Corvallis, Oregon, USA' },
  { num: 973,  name: 'Greybots',                            location: 'Atascadero, California, USA' },
  { num: 987,  name: 'HIGHROLLERS',                         location: 'Las Vegas, Nevada, USA' },
  { num: 1002, name: 'CircuitRunners Robotics',             location: 'Marietta, Georgia, USA' },
  { num: 1014, name: 'Bad Robots',                          location: 'Dublin, Ohio, USA' },
  { num: 1108, name: 'Panther Robotics',                    location: 'Paola, Kansas, USA' },
  { num: 1155, name: 'SciBorgs',                            location: 'Bronx, New York, USA' },
  { num: 1156, name: 'Under Control',                       location: 'Novo Hamburgo, Rio Grande do Sul, Brazil' },
  { num: 1261, name: 'Robo Lions Team1261',                 location: 'Suwanee, Georgia, USA' },
  { num: 1287, name: 'Aluminum Assault',                    location: 'Myrtle Beach, South Carolina, USA' },
  { num: 1323, name: 'MadTown Robotics',                    location: 'Madera, California, USA' },
  { num: 1511, name: 'Rolling Thunder',                     location: 'Penfield, New York, USA' },
  { num: 1540, name: 'Flaming Chickens',                    location: 'Portland, Oregon, USA' },
  { num: 1577, name: 'Steampunk',                           location: 'Raanana, HaMerkaz, Israel' },
  { num: 1619, name: 'Up-A-Creek Robotics',                 location: 'Longmont, Colorado, USA' },
  { num: 1625, name: 'Winnovation',                         location: 'Winnebago, Illinois, USA' },
  { num: 1629, name: 'Garrett Coalition (GaCo)',            location: 'Accident, Maryland, USA' },
  { num: 1648, name: 'G3 Robotics',                         location: 'Atlanta, Georgia, USA' },
  { num: 1671, name: 'Buchanan Bird Brains',                location: 'Clovis, California, USA' },
  { num: 1690, name: 'Orbit',                               location: 'Binyamina, HaZafon, Israel' },
  { num: 1706, name: 'Ratchet Rockers',                     location: 'Wentzville, Missouri, USA' },
  { num: 1710, name: 'The Ravonics Revolution',             location: 'Olathe, Kansas, USA' },
  { num: 1727, name: 'REX',                                 location: 'Lutherville Timonium, Maryland, USA' },
  { num: 1731, name: 'Fresta Valley Robotics Club',         location: 'Warrenton, Virginia, USA' },
  { num: 1756, name: 'Argos',                               location: 'Peoria, Illinois, USA' },
  { num: 1771, name: 'North Gwinnett Robotics',             location: 'Suwanee, Georgia, USA' },
  { num: 1787, name: 'The Flying Circuits',                 location: 'Pepper Pike, Ohio, USA' },
  { num: 1796, name: 'RoboTigers',                          location: 'Queens, New York, USA' },
  { num: 1816, name: '"The Green Machine"',                 location: 'Edina, Minnesota, USA' },
  { num: 1833, name: 'Team BEAN',                           location: 'Cumming, Georgia, USA' },
  { num: 1880, name: 'Warriors of East Harlem',             location: 'New York, New York, USA' },
  { num: 1884, name: 'Griffins',                            location: 'London, England, United Kingdom' },
  { num: 1902, name: 'Exploding Bacon',                     location: 'Orlando, Florida, USA' },
  { num: 1908, name: 'ShoreBots',                           location: 'Eastville, Virginia, USA' },
  { num: 1912, name: 'Team Combustion',                     location: 'Slidell, Louisiana, USA' },
  { num: 1939, name: 'THE KUHNIGHTS',                       location: 'Kansas City, Missouri, USA' },
  { num: 1986, name: 'Team Titanium',                       location: 'Lees Summit, Missouri, USA' },
  { num: 1987, name: 'Broncobots',                          location: 'Lees Summit, Missouri, USA' },
  { num: 2040, name: 'DERT - Dunlap Eagles Robotics Team',  location: 'Dunlap, Illinois, USA' },
  { num: 2052, name: 'KnightKrawler',                       location: 'New Brighton, Minnesota, USA' },
  { num: 2053, name: 'Southern Tier Robotics',              location: 'Vestal, New York, USA' },
  { num: 2096, name: 'RoboActive',                          location: 'Dimona, HaDarom, Israel' },
  { num: 2102, name: 'Team Paradox',                        location: 'Encinitas, California, USA' },
  { num: 2106, name: 'The Junkyard Dogs',                   location: 'Goochland, Virginia, USA' },
  { num: 2122, name: 'Team Tators',                         location: 'Boise, Idaho, USA' },
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
    divisionEvent:    { ...existing.divisionEvent },
    matchPreds:       { ...existing.matchPreds },
  };

  // ── STEP 1: Find most recent 2026 event per team ───────────────────────────
  if (!STEPS.has(1)) { console.log('STEP 1/5 — Skipped'); }
  else { console.log(`STEP 1/5 — Finding most recent 2026 event for each team...`);
  const teamEventMap = {};

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

  const uniqueEventKeys = [...new Set(Object.values(teamEventMap).map(ev => ev.key))];
  ok(`Step 1 complete — ${uniqueEventKeys.length} unique events across ${HOUSTON_TEAMS.length} teams`);
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

  // ── STEP 3: Statbotics EPA ─────────────────────────────────────────────────
  if (!STEPS.has(3)) { console.log('STEP 3/5 — Skipped'); }
  else { console.log(`STEP 3/5 — Fetching Statbotics EPA for ${HOUSTON_TEAMS.length} teams...`);

  for (let i = 0; i < HOUSTON_TEAMS.length; i++) {
    const team = HOUSTON_TEAMS[i];
    const teamKey = `frc${team.num}`;
    try {
      const records = await statboticsFetch(`/team_events?team=${team.num}&year=2026&limit=20`);
      if (Array.isArray(records)) {
        records.forEach(record => {
          const epa = extractEPA(record);
          if (epa && record.event) output.epa[teamKey][record.event] = epa;
        });
        const epaCount = Object.keys(output.epa[teamKey]).length;
        if (epaCount > 0) process.stdout.write(`  [${i+1}/${HOUSTON_TEAMS.length}] ${teamKey} — ${epaCount} EPA record(s)\n`);
        else              process.stdout.write(`  [${i+1}/${HOUSTON_TEAMS.length}] ${teamKey} — no EPA data yet\n`);
      }
    } catch (e) {
      warn(`Statbotics EPA failed for team ${team.num}: ${e.message}`);
    }
    await sleep(100);
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

    log('Writing root houston.json ...');
    await commitFile('houston.json', output, `chore: houston refresh root ${output.fetchedAt}`);
    ok('houston.json committed');
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
