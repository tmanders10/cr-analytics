/**
 * CR Analytics — /api/refresh-houston-init
 * -----------------------------------------
 * One-time heavy refresh: fetches full 2026 season data for all Houston teams.
 *
 * Data structure (deduplication by storing matches ONCE per event):
 *   events[eventKey] = { eventName, week, matches[], rankings, oprs }
 *   teamEventKeys[teamNum] = [eventKey, ...]   <- which events each team attended
 *   epa[frcXXXX][eventKey] = { total, auto, ... }
 *   ace[teamNum] = { ace, confidence, rank_global, ... }
 *   divisionEvent = { matches[], rankings, alliances[] }
 *   matchPreds[matchKey] = { winner, prob }
 */

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

async function tbaFetch(path, tbaKey) {
  const res = await fetch(`https://www.thebluealliance.com/api/v3${path}`, {
    headers: { 'X-TBA-Auth-Key': tbaKey }
  });
  if (!res.ok) throw new Error(`TBA HTTP ${res.status} for ${path}`);
  return res.json();
}

async function statboticsFetch(path) {
  const res = await fetch(`https://api.statbotics.io/v3${path}`, {
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`Statbotics HTTP ${res.status}`);
  return res.json();
}

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

function slimMatch(m) {
  return {
    key:              m.key,
    comp_level:       m.comp_level,
    match_number:     m.match_number,
    set_number:       m.set_number      ?? 1,
    winning_alliance: m.winning_alliance ?? '',
    predicted_time:   m.predicted_time  ?? null,
    actual_time:      m.actual_time     ?? null,
    videos: (m.videos || []).filter(v => v.type === 'youtube').map(v => ({ key: v.key, type: v.type })),
    alliances: {
      red:  { team_keys: m.alliances?.red?.team_keys  || [], score: m.alliances?.red?.score  ?? -1 },
      blue: { team_keys: m.alliances?.blue?.team_keys || [], score: m.alliances?.blue?.score ?? -1 },
    },
    score_breakdown: m.score_breakdown ? {
      red:  slimBreakdown(m.score_breakdown.red),
      blue: slimBreakdown(m.score_breakdown.blue),
    } : null,
  };
}

function slimBreakdown(bd) {
  if (!bd) return null;
  return {
    autoPoints:           bd.autoPoints           ?? bd.auto_points     ?? null,
    teleopPoints:         bd.teleopPoints         ?? bd.teleop_points   ?? null,
    endgamePoints:        bd.endgamePoints        ?? bd.endgame_points  ?? null,
    autoReef:             bd.autoReef             ?? null,
    teleopReef:           bd.teleopReef           ?? null,
    autoCoral:            bd.autoCoral            ?? null,
    teleopCoral:          bd.teleopCoral          ?? null,
    netAlgaePoints:       bd.netAlgaePoints       ?? null,
    processorAlgaePoints: bd.processorAlgaePoints ?? null,
    endGameBargePoints:   bd.endGameBargePoints   ?? null,
    totalPoints:          bd.totalPoints          ?? bd.total_points    ?? null,
    foulPoints:           bd.foulPoints           ?? bd.foul_points     ?? null,
    rp:                   bd.rp                   ?? null,
  };
}

// Only keep OPR values for the 75 Houston teams (ignore all other teams at those events)
function slimOprs(oprs) {
  if (!oprs || !oprs.oprs) return {};
  const houstonKeys = new Set(HOUSTON_TEAMS.map(t => `frc${t.num}`));
  const result = { oprs: {} };
  for (const [k, v] of Object.entries(oprs.oprs || {})) {
    if (houstonKeys.has(k)) result.oprs[k] = Math.round(v * 10) / 10;
  }
  return result;
}

function slimRankings(rankings) {
  if (!rankings || !rankings.rankings) return {};
  return {
    sort_order_info:  rankings.sort_order_info  || [],
    extra_stats_info: rankings.extra_stats_info || [],
    rankings: (rankings.rankings || []).map(r => ({
      rank:           r.rank,
      team_key:       r.team_key,
      record:         r.record,
      sort_orders:    r.sort_orders,
      extra_stats:    r.extra_stats,
      matches_played: r.matches_played,
      dq:             r.dq,
    })),
  };
}

async function getFileSHA(url, token) {
  const res = await fetch(url, { headers: { Authorization: `token ${token}`, 'User-Agent': 'cr-analytics' } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.sha || null;
}

async function commitFile(url, content, sha, token, message) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'cr-analytics' },
    body: JSON.stringify({ message, content, sha }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub commit failed: ${err.message}`);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const TBA_KEY       = process.env.TBA_KEY;
  const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
  const GITHUB_REPO   = process.env.GITHUB_REPO;
  const PEEKOROBO_KEY = process.env.PEEKOROBO_API_KEY;
  const DIVISION      = process.env.HOUSTON_DIVISION || 'Division TBD';
  const DIV_EVENT_KEY = process.env.HOUSTON_DIVISION_EVENT_KEY || '';

  if (!TBA_KEY)      return res.status(500).json({ error: 'TBA_KEY not configured' });
  if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
  if (!GITHUB_REPO)  return res.status(500).json({ error: 'GITHUB_REPO not configured' });

  const log = [];
  const warn = (msg) => { console.warn(msg); log.push(msg); };

  try {
    const output = {
      division:        DIVISION,
      divisionEventKey: DIV_EVENT_KEY,
      fetchedAt:       new Date().toISOString(),
      teams:           HOUSTON_TEAMS,
      // events[eventKey] = { eventName, week, matches[], rankings, oprs }
      // Matches stored ONCE per event — no duplication across teams
      events:          {},
      // teamEventKeys[teamNum] = [eventKey, ...]
      teamEventKeys:   {},
      // epa[frcXXXX][eventKey] = { total, auto, teleop, endgame, sd, norm }
      epa:             {},
      // ace[teamNum] = { ace, confidence, rank_global, ... }
      ace:             {},
      // divisionEvent = { matches[], rankings, alliances[] }
      divisionEvent:   {},
      // matchPreds[matchKey] = { winner, prob }
      matchPreds:      {},
    };

    // ── Step 1: Find the most recent 2026 event for each team ──
    const teamEventMap = {}; // teamNum -> single most recent event {key, short_name, name, week}
    for (let i = 0; i < HOUSTON_TEAMS.length; i++) {
      const team = HOUSTON_TEAMS[i];
      const teamKey = `frc${team.num}`;
      output.teamEventKeys[team.num] = [];
      output.epa[teamKey] = {};
      try {
        const events = await tbaFetch(`/team/${teamKey}/events/2026/simple`, TBA_KEY);
        const regEvents = (events || [])
          .filter(ev => ev.event_type <= 6 || ev.event_type === 99)
          .sort((a, b) => (b.week ?? 0) - (a.week ?? 0)); // most recent first
        // Take only the most recent event (excludes Houston itself — event_type 3 = district CMP, etc.)
        const mostRecent = regEvents[0] || null;
        if (mostRecent) {
          teamEventMap[team.num] = mostRecent;
          output.teamEventKeys[team.num] = [mostRecent.key];
        } else {
          warn(`No 2026 events found for ${teamKey}`);
        }
      } catch (e) {
        warn(`Events fetch failed for ${teamKey}: ${e.message}`);
      }
      if (i % 10 === 9) await sleep(300);
    }

    // ── Step 2: Fetch each unique event ONCE (deduplicated) ──
    // Many teams share events (e.g. multiple PCH teams all attended GACMP)
    const allEventKeys = new Set();
    const eventMeta = {};
    Object.entries(teamEventMap).forEach(([teamNum, ev]) => {
      if (ev) {
        allEventKeys.add(ev.key);
        eventMeta[ev.key] = { eventName: ev.short_name || ev.name, week: ev.week ?? 0 };
      }
    });

    for (const evKey of allEventKeys) {
      try {
        const [matches, rankings, oprs] = await Promise.all([
          tbaFetch(`/event/${evKey}/matches`, TBA_KEY).catch(() => []),
          tbaFetch(`/event/${evKey}/rankings`, TBA_KEY).catch(() => ({})),
          tbaFetch(`/event/${evKey}/oprs`, TBA_KEY).catch(() => ({})),
        ]);
        output.events[evKey] = {
          eventName: eventMeta[evKey]?.eventName || evKey,
          week:      eventMeta[evKey]?.week      || 0,
          matches:   (matches || []).map(slimMatch),
          rankings:  slimRankings(rankings),
          oprs:      slimOprs(oprs),
        };
      } catch (e) {
        warn(`Event fetch failed for ${evKey}: ${e.message}`);
      }
      await sleep(100);
    }

    // ── Step 3: Statbotics EPA — most recent event only per team ──
    for (const team of HOUSTON_TEAMS) {
      const teamKey = `frc${team.num}`;
      const evKey = output.teamEventKeys[team.num]?.[0];
      if (!evKey) continue;
      try {
        const records = await statboticsFetch(`/team_events?team=${team.num}&year=2026&limit=20`);
        if (Array.isArray(records)) {
          records.forEach(record => {
            const epa = extractEPA(record);
            // Store all events' EPA for accurate "latest" lookup, but only if we have match data
            if (epa && record.event) output.epa[teamKey][record.event] = epa;
          });
        }
      } catch (e) {
        warn(`Statbotics EPA failed for team ${team.num}: ${e.message}`);
      }
    }

    // ── Step 4: Peekorobo ACE for all teams ──
    if (PEEKOROBO_KEY) {
      const BATCH = 20;
      for (let i = 0; i < HOUSTON_TEAMS.length; i += BATCH) {
        const batch = HOUSTON_TEAMS.slice(i, i + BATCH);
        await Promise.all(batch.map(async team => {
          try {
            const r = await fetch(`https://www.peekorobo.com/api/team_perfs/${team.num}`,
              { headers: { 'X-Api-Key': PEEKOROBO_KEY } });
            if (!r.ok) return;
            const data = await r.json();
            const perfs = (data.team_perfs || []).find(p => p.year === 2026) || null;
            if (perfs) {
              output.ace[team.num] = {
                ace:            perfs.ace            ?? null,
                raw:            perfs.raw            ?? null,
                confidence:     perfs.confidence     ?? null,
                rank_global:    perfs.rank_global    ?? null,
                rank_country:   perfs.rank_country   ?? null,
                rank_state:     perfs.rank_state     ?? null,
                rank_district:  perfs.rank_district  ?? null,
              };
            }
          } catch (e) {
            warn(`ACE failed for team ${team.num}: ${e.message}`);
          }
        }));
      }
    }

    // ── Step 5: Division event data (if key is configured) ──
    if (DIV_EVENT_KEY) {
      try {
        const [matches, rankings, alliances] = await Promise.all([
          tbaFetch(`/event/${DIV_EVENT_KEY}/matches`, TBA_KEY).catch(() => []),
          tbaFetch(`/event/${DIV_EVENT_KEY}/rankings`, TBA_KEY).catch(() => ({})),
          tbaFetch(`/event/${DIV_EVENT_KEY}/alliances`, TBA_KEY).catch(() => []),
        ]);
        output.divisionEvent = {
          matches:   (matches || []).map(slimMatch),
          rankings:  slimRankings(rankings),
          alliances: alliances || [],
        };
        // Statbotics match predictions
        try {
          const sbMatches = await statboticsFetch(`/matches?event=${DIV_EVENT_KEY}&limit=200`);
          if (Array.isArray(sbMatches)) {
            sbMatches.forEach(m => {
              if (!m.key || !m.pred) return;
              const winner = m.pred.winner      ?? null;
              const prob   = m.pred.red_win_prob ?? null;
              if (winner !== null && prob !== null) output.matchPreds[m.key] = { winner, prob };
            });
          }
        } catch (e) {
          warn(`Statbotics preds failed for ${DIV_EVENT_KEY}: ${e.message}`);
        }
      } catch (e) {
        warn(`Division event fetch failed: ${e.message}`);
      }
    }

    // ── Step 6: Write houston.json to GitHub ──
    const content = Buffer.from(JSON.stringify(output)).toString('base64'); // no pretty-print = smaller
    const commitMsg = `chore: houston init ${new Date().toISOString()}`;
    const files = [
      `https://api.github.com/repos/${GITHUB_REPO}/contents/public/houston.json`,
      `https://api.github.com/repos/${GITHUB_REPO}/contents/houston.json`,
    ];
    for (const fileUrl of files) {
      const sha = await getFileSHA(fileUrl, GITHUB_TOKEN);
      await commitFile(fileUrl, content, sha, GITHUB_TOKEN, commitMsg);
    }

    const totalMatches = Object.values(output.events).reduce((s, ev) => s + (ev.matches?.length || 0), 0);

    return res.status(200).json({
      success:          true,
      fetchedAt:        output.fetchedAt,
      division:         DIVISION,
      divisionEventKey: DIV_EVENT_KEY || '(not set)',
      teams:            HOUSTON_TEAMS.length,
      uniqueEvents:     Object.keys(output.events).length,
      totalMatches,
      aceTeams:         Object.keys(output.ace).length,
      warnings:         log.length,
      log:              log.slice(0, 20),
    });

  } catch (err) {
    console.error('Houston init error:', err);
    return res.status(500).json({ error: err.message, log });
  }
};
