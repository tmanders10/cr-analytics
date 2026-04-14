/**
 * CR Analytics — /api/refresh-houston-matches
 * ---------------------------------------------
 * Lightweight match-day refresh for Houston division.
 * Fetches: division event matches + rankings + Statbotics predictions.
 * Preserves all existing houston.json data (team history, EPA, ACE).
 */

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

  const TBA_KEY       = process.env.TBA_KEY;
  const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
  const GITHUB_REPO   = process.env.GITHUB_REPO;
  const DIV_EVENT_KEY = process.env.HOUSTON_DIVISION_EVENT_KEY || '';

  if (!TBA_KEY)      return res.status(500).json({ error: 'TBA_KEY not configured' });
  if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
  if (!GITHUB_REPO)  return res.status(500).json({ error: 'GITHUB_REPO not configured' });

  if (!DIV_EVENT_KEY) {
    return res.status(200).json({
      success: false,
      message: 'HOUSTON_DIVISION_EVENT_KEY not configured — set it in Vercel env vars once division is announced.',
    });
  }

  try {
    // ── Load existing houston.json ──
    let existing = {};
    try {
      const metaRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/public/houston.json`,
        { headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'cr-analytics' } }
      );
      if (!metaRes.ok) throw new Error(`Metadata fetch failed: HTTP ${metaRes.status}`);
      const meta = await metaRes.json();
      let decoded;
      if (meta.content && meta.encoding === 'base64' && meta.size < 900000) {
        decoded = Buffer.from(meta.content.replace(/\n/g, ''), 'base64').toString('utf8');
      } else {
        const blobRes = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/git/blobs/${meta.sha}`,
          { headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'cr-analytics', Accept: 'application/vnd.github.v3.raw' } }
        );
        if (!blobRes.ok) throw new Error(`Blob fetch failed: HTTP ${blobRes.status}`);
        decoded = await blobRes.text();
      }
      existing = JSON.parse(decoded);
    } catch (e) {
      return res.status(500).json({ error: `Aborted: could not load houston.json — ${e.message}. Run Houston Init first.` });
    }

    // ── Fetch division event matches + rankings ──
    const [matches, rankings] = await Promise.all([
      tbaFetch(`/event/${DIV_EVENT_KEY}/matches`, TBA_KEY).catch(() => []),
      tbaFetch(`/event/${DIV_EVENT_KEY}/rankings`, TBA_KEY).catch(() => ({})),
    ]);

    // ── Fetch Statbotics match predictions ──
    let matchPreds = { ...(existing.matchPreds || {}) };
    try {
      const sbMatches = await statboticsFetch(`/matches?event=${DIV_EVENT_KEY}&limit=200`);
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
      // Non-fatal — keep existing predictions
    }

    // ── Merge — preserve all existing data, update only division event ──
    const output = {
      ...existing,
      fetchedAt: new Date().toISOString(),
      matchPreds,
      divisionEvent: {
        ...(existing.divisionEvent || {}),
        matches: matches || [],
        rankings: rankings || {},
      },
    };

    // ── Write to GitHub ──
    const content = Buffer.from(JSON.stringify(output, null, 2)).toString('base64');
    const commitMsg = `chore: houston match update ${DIV_EVENT_KEY} ${new Date().toISOString()}`;
    const files = [
      `https://api.github.com/repos/${GITHUB_REPO}/contents/public/houston.json`,
      `https://api.github.com/repos/${GITHUB_REPO}/contents/houston.json`,
    ];
    for (const fileUrl of files) {
      const sha = await getFileSHA(fileUrl, GITHUB_TOKEN);
      if (!sha) continue;
      await commitFile(fileUrl, content, sha, GITHUB_TOKEN, commitMsg);
    }

    return res.status(200).json({
      success: true,
      fetchedAt: output.fetchedAt,
      divisionEventKey: DIV_EVENT_KEY,
      matches: (matches || []).length,
      predictions: Object.keys(matchPreds).length,
    });

  } catch (err) {
    console.error('Houston match update error:', err);
    return res.status(500).json({ error: err.message });
  }
};
