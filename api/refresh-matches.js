/**
 * CR Analytics — /api/refresh-matches
 * -------------------------------------
 * Lightweight refresh: only fetches match data for the currently active event.
 * No rankings, no alliances, no team info, no Statbotics EPA.
 * Designed for quick mid-event updates between matches (~3-5 seconds).
 */

const EVENTS = [
  { key: '2026gadal', short: 'DAL', name: 'Dalton',          week: 1, start: '2026-02-27', end: '2026-03-01' },
  { key: '2026gagwi', short: 'GWI', name: 'Gwinnett',        week: 2, start: '2026-03-06', end: '2026-03-08' },
  { key: '2026gacol', short: 'COL', name: 'Columbus',        week: 3, start: '2026-03-13', end: '2026-03-15' },
  { key: '2026gaalb', short: 'ALB', name: 'Albany',          week: 4, start: '2026-03-20', end: '2026-03-22' },
  { key: '2026gagai', short: 'GAI', name: 'Gainesville',     week: 5, start: '2026-04-02', end: '2026-04-04' },
  { key: '2026gacmp', short: 'CMP', name: 'District Champs', week: 6, start: '2026-04-08', end: '2026-04-11' },
];

function getActiveEvent() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Find event whose window includes today (with 1-day lead and 1-day grace)
  return EVENTS.find(ev => {
    const start = new Date(ev.start);
    start.setDate(start.getDate() - 1);
    const end = new Date(ev.end);
    end.setDate(end.getDate() + 1);
    return today >= start && today <= end;
  }) || null;
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

  const activeEvent = getActiveEvent();
  if (!activeEvent) {
    return res.status(200).json({
      success: false,
      message: 'No active event today — use Full Refresh instead.',
    });
  }

  try {
    // Load existing data.json from GitHub using blob API (handles files > 1MB)
    // The contents API silently truncates large files, so we use the blob SHA instead
    let existing;
    try {
      // Step 1: Get the blob SHA for public/data.json via contents API
      const metaRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/public/data.json`,
        { headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'cr-analytics' } }
      );
      if (!metaRes.ok) throw new Error(`Metadata fetch failed: HTTP ${metaRes.status}`);
      const meta = await metaRes.json();

      // Step 2: If file is small enough, use content directly; otherwise fetch via blob API
      let decoded;
      if (meta.content && meta.encoding === 'base64' && meta.size < 900000) {
        // Small enough — use inline content
        decoded = Buffer.from(meta.content.replace(/\n/g, ''), 'base64').toString('utf8');
      } else {
        // Large file — fetch via blob API using the sha
        const blobRes = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/git/blobs/${meta.sha}`,
          { headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'cr-analytics', Accept: 'application/vnd.github.v3.raw' } }
        );
        if (!blobRes.ok) throw new Error(`Blob fetch failed: HTTP ${blobRes.status}`);
        decoded = await blobRes.text();
      }

      existing = JSON.parse(decoded);
    } catch (e) {
      // Safety abort — never proceed without existing data or we'll wipe all other events
      return res.status(500).json({ error: `Aborted: could not load existing data — ${e.message}. Use Full Refresh instead.` });
    }

    // Fetch only matches for the active event
    const matches = await tbaFetch(`/event/${activeEvent.key}/matches`, TBA_KEY);

    // Fetch rankings for the active event (keeps Event Standings current)
    let rankings = existing.events?.[activeEvent.key]?.rankings || {};
    try {
      rankings = await tbaFetch(`/event/${activeEvent.key}/rankings`, TBA_KEY) || rankings;
    } catch (e) {}

    // Fetch Statbotics match predictions for the active event
    let matchPreds = { ...(existing.matchPreds || {}) };
    try {
      const sbMatches = await statboticsFetch(`/matches?event=${activeEvent.key}&limit=200`);
      if (Array.isArray(sbMatches)) {
        sbMatches.forEach(m => {
          if (!m.key || !m.pred) return;
          const winner = m.pred.winner ?? null;
          const prob   = m.pred.red_win_prob ?? null;
          if (winner !== null && prob !== null) {
            matchPreds[m.key] = { winner, prob };
          }
        });
      }
    } catch (e) {
      // Non-fatal — keep existing predictions if Statbotics is unavailable
    }

    // Merge into existing data — replace only the active event's matches
    const output = {
      ...existing,
      fetchedAt: new Date().toISOString(),
      matchPreds,
      events: {
        ...existing.events,
        [activeEvent.key]: {
          ...(existing.events[activeEvent.key] || { meta: activeEvent }),
          matches: matches || [],
          rankings,
        },
      },
    };

    // Commit to public/data.json only
    const content = Buffer.from(JSON.stringify(output, null, 2)).toString('base64');
    const commitMsg = `chore: quick match update ${activeEvent.short} ${new Date().toISOString()}`;
    const sha = await getFileSHA(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/public/data.json`,
      GITHUB_TOKEN
    );
    if (sha) await commitFile(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/public/data.json`,
      content, sha, GITHUB_TOKEN, commitMsg
    );

    return res.status(200).json({
      success: true,
      fetchedAt: output.fetchedAt,
      event: activeEvent.short,
      eventName: activeEvent.name,
      matches: (matches || []).length,
    });

  } catch (err) {
    console.error('Quick refresh error:', err);
    return res.status(500).json({ error: err.message });
  }
};
