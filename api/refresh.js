/**
 * CR Analytics — /api/refresh
 * ----------------------------
 * Vercel serverless function. Fetches fresh data from TBA + Statbotics
 * and writes it to public/data.json, then commits via the GitHub API.
 *
 * Called by the "Refresh Now" button in the app header.
 * Requires environment variables set in Vercel dashboard:
 *   TBA_KEY        — your TBA read API key
 *   GITHUB_TOKEN   — a GitHub personal access token (repo scope)
 *   GITHUB_REPO    — e.g. "tmanders10/cr-analytics"
 */

const EVENTS = [
  { key: '2026gadal', short: 'DAL', name: 'Dalton',          week: 1 },
  { key: '2026gagwi', short: 'GWI', name: 'Gwinnett',        week: 2 },
  { key: '2026gacol', short: 'COL', name: 'Columbus',        week: 3 },
  { key: '2026gaalb', short: 'ALB', name: 'Albany',          week: 4 },
  { key: '2026gagai', short: 'GAI', name: 'Gainesville',     week: 5 },
  { key: '2026gacmp', short: 'CMP', name: 'District Champs', week: 6 },
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
    total:   e.total_points?.mean   ?? null,
    auto:    bd.auto_points         ?? null,
    teleop:  bd.teleop_points       ?? null,
    endgame: bd.endgame_points      ?? null,
    sd:      e.total_points?.sd     ?? null,
    norm:    e.norm                 ?? null,
  };
}

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const TBA_KEY      = process.env.TBA_KEY;
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO  = process.env.GITHUB_REPO; // e.g. "tmanders10/cr-analytics"

  if (!TBA_KEY)      return res.status(500).json({ error: 'TBA_KEY not configured' });
  if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
  if (!GITHUB_REPO)  return res.status(500).json({ error: 'GITHUB_REPO not configured' });

  try {
    const output = {
      fetchedAt: new Date().toISOString(),
      events: {},
      districtRankings: [],
      teams: {},
      epa: {},
    };

    // ── TBA: matches, rankings, alliances ──
    for (const ev of EVENTS) {
      try {
        const [matches, rankings, alliances] = await Promise.all([
          tbaFetch(`/event/${ev.key}/matches`, TBA_KEY),
          tbaFetch(`/event/${ev.key}/rankings`, TBA_KEY),
          tbaFetch(`/event/${ev.key}/alliances`, TBA_KEY),
        ]);
        output.events[ev.key] = {
          meta: ev,
          matches: matches || [],
          rankings: rankings || {},
          alliances: alliances || [],
        };
      } catch (e) {
        output.events[ev.key] = { meta: ev, matches: [], rankings: {}, alliances: [] };
      }
    }

    // ── TBA: district rankings ──
    try {
      output.districtRankings = await tbaFetch('/district/2026pch/rankings', TBA_KEY) || [];
    } catch (e) {}

    // ── TBA: team info ──
    const teamKeys = new Set();
    Object.values(output.events).forEach(ev => {
      (ev.matches || []).forEach(m => {
        (m.alliances?.red?.team_keys  || []).forEach(k => teamKeys.add(k));
        (m.alliances?.blue?.team_keys || []).forEach(k => teamKeys.add(k));
      });
    });
    const teamArr = [...teamKeys];
    for (let i = 0; i < teamArr.length; i += 10) {
      await Promise.all(teamArr.slice(i, i + 10).map(async k => {
        try { output.teams[k] = await tbaFetch(`/team/${k}/simple`, TBA_KEY); } catch (e) {}
      }));
    }

    // ── Statbotics: EPA ──
    for (const ev of EVENTS) {
      try {
        const records = await statboticsFetch(`/team_events?event=${ev.key}&limit=100`);
        if (Array.isArray(records)) {
          records.forEach(record => {
            const teamKey = `frc${record.team}`;
            if (!output.epa[teamKey]) output.epa[teamKey] = {};
            const epa = extractEPA(record);
            if (epa) output.epa[teamKey][ev.key] = epa;
          });
        }
      } catch (e) {}
    }

    // ── Write to GitHub via API ──
    const content = Buffer.from(JSON.stringify(output, null, 2)).toString('base64');

    // Get current SHA of data.json (needed for update)
    const shaRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'cr-analytics' } }
    );
    const shaData = await shaRes.json();
    const sha = shaData.sha;

    // Commit updated data.json
    const commitRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`,
      {
        method: 'PUT',
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'cr-analytics',
        },
        body: JSON.stringify({
          message: `chore: refresh data ${new Date().toISOString()}`,
          content,
          sha,
        }),
      }
    );

    if (!commitRes.ok) {
      const err = await commitRes.json();
      throw new Error(`GitHub commit failed: ${err.message}`);
    }

    const matchCount = Object.values(output.events).reduce((s, ev) => s + (ev.matches?.length || 0), 0);
    const epaCount = Object.keys(output.epa).length;

    return res.status(200).json({
      success: true,
      fetchedAt: output.fetchedAt,
      matches: matchCount,
      teams: Object.keys(output.teams).length,
      epaTeams: epaCount,
    });

  } catch (err) {
    console.error('Refresh error:', err);
    return res.status(500).json({ error: err.message });
  }
}
