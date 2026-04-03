/**
 * CR Analytics — /api/refresh
 * ----------------------------
 * Smart serverless refresh: only fetches TBA data for active/upcoming events.
 * Completed events reuse existing data. EPA always refreshes.
 */

const EVENTS = [
  { key: '2026gadal', short: 'DAL', name: 'Dalton',          week: 1, start: '2026-02-27', end: '2026-03-01' },
  { key: '2026gagwi', short: 'GWI', name: 'Gwinnett',        week: 2, start: '2026-03-06', end: '2026-03-08' },
  { key: '2026gacol', short: 'COL', name: 'Columbus',        week: 3, start: '2026-03-13', end: '2026-03-15' },
  { key: '2026gaalb', short: 'ALB', name: 'Albany',          week: 4, start: '2026-03-20', end: '2026-03-22' },
  { key: '2026gagai', short: 'GAI', name: 'Gainesville',     week: 5, start: '2026-04-02', end: '2026-04-04' },
  { key: '2026gacmp', short: 'CMP', name: 'District Champs', week: 6, start: '2026-04-08', end: '2026-04-11' },
];

function eventStatus(ev) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(ev.start);
  const end   = new Date(ev.end);
  const grace = new Date(end);
  grace.setDate(grace.getDate() + 2);
  if (today > grace)  return 'complete';
  if (today >= start) return 'active';
  return 'upcoming';
}

async function tbaFetch(path, tbaKey) {
  const res = await fetch(`https://www.thebluealliance.com/api/v3${path}`, {
    headers: { 'X-TBA-Auth-Key': tbaKey }
  });
  if (!res.ok) throw new Error(`TBA HTTP ${res.status}`);
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

async function getFileSHA(url, token) {
  const res = await fetch(url, {
    headers: { Authorization: `token ${token}`, 'User-Agent': 'cr-analytics' }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.sha || null;
}

async function commitFile(url, content, sha, token, message) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'cr-analytics',
    },
    body: JSON.stringify({ message, content, sha }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub commit failed: ${err.message}`);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const TBA_KEY      = process.env.TBA_KEY;
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO  = process.env.GITHUB_REPO;

  if (!TBA_KEY)      return res.status(500).json({ error: 'TBA_KEY not configured' });
  if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
  if (!GITHUB_REPO)  return res.status(500).json({ error: 'GITHUB_REPO not configured' });

  try {
    // Load existing data.json from GitHub to preserve completed event data
    // Uses blob API to handle files > 1MB (contents API silently truncates)
    let existing = { events: {}, districtRankings: [], teams: {}, epa: {} };
    try {
      const metaRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/public/data.json`,
        { headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'cr-analytics' } }
      );
      if (metaRes.ok) {
        const meta = await metaRes.json();
        let decoded;
        if (meta.content && meta.encoding === 'base64' && meta.size < 900000) {
          decoded = Buffer.from(meta.content.replace(/\n/g, ''), 'base64').toString('utf8');
        } else {
          const blobRes = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/git/blobs/${meta.sha}`,
            { headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'cr-analytics', Accept: 'application/vnd.github.v3.raw' } }
          );
          if (blobRes.ok) decoded = await blobRes.text();
        }
        if (decoded) existing = JSON.parse(decoded);
      }
    } catch (e) {}

    const output = {
      fetchedAt: new Date().toISOString(),
      events: {},
      districtRankings: existing.districtRankings || [],
      teams: existing.teams || {},
      epa: existing.epa || {},
    };

    // ── TBA: smart event fetching ──
    for (const ev of EVENTS) {
      const status = eventStatus(ev);

      if (status === 'complete' && existing.events?.[ev.key]?.matches?.length > 0) {
        // Reuse cached data for completed events
        output.events[ev.key] = existing.events[ev.key];
        continue;
      }

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
        output.events[ev.key] = existing.events?.[ev.key] ||
          { meta: ev, matches: [], rankings: {}, alliances: [] };
      }
    }

    // ── TBA: district rankings (always refresh) ──
    try {
      output.districtRankings = await tbaFetch('/district/2026pch/rankings', TBA_KEY) || [];
    } catch (e) {}

    // ── TBA: team info (only new teams) ──
    const teamKeys = new Set();
    Object.values(output.events).forEach(ev => {
      (ev.matches || []).forEach(m => {
        (m.alliances?.red?.team_keys  || []).forEach(k => teamKeys.add(k));
        (m.alliances?.blue?.team_keys || []).forEach(k => teamKeys.add(k));
      });
    });
    const newTeams = [...teamKeys].filter(k => !output.teams[k]);
    for (let i = 0; i < newTeams.length; i += 10) {
      await Promise.all(newTeams.slice(i, i + 10).map(async k => {
        try { output.teams[k] = await tbaFetch(`/team/${k}/simple`, TBA_KEY); } catch (e) {}
      }));
    }

    // ── Statbotics: EPA (always refresh active/complete events) ──
    for (const ev of EVENTS) {
      const status = eventStatus(ev);
      if (status === 'upcoming' && !existing.events?.[ev.key]?.matches?.length) continue;
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

    // ── Write to GitHub (both public/data.json and root data.json) ──
    const content = Buffer.from(JSON.stringify(output, null, 2)).toString('base64');
    const commitMsg = `chore: refresh data ${new Date().toISOString()}`;
    const files = [
      `https://api.github.com/repos/${GITHUB_REPO}/contents/public/data.json`,
      `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`,
    ];
    for (const fileUrl of files) {
      const sha = await getFileSHA(fileUrl, GITHUB_TOKEN);
      if (!sha) continue;
      await commitFile(fileUrl, content, sha, GITHUB_TOKEN, commitMsg);
    }

    const matchCount = Object.values(output.events)
      .reduce((s, ev) => s + (ev.matches?.length || 0), 0);

    return res.status(200).json({
      success: true,
      fetchedAt: output.fetchedAt,
      matches: matchCount,
      teams: Object.keys(output.teams).length,
      epaTeams: Object.keys(output.epa).length,
    });

  } catch (err) {
    console.error('Refresh error:', err);
    return res.status(500).json({ error: err.message });
  }
};
