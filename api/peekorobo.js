// api/peekorobo.js
// Serverless proxy for Peekorobo API — keeps API key server-side
// Usage: GET /api/peekorobo?teams=1002,1771,6919

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const apiKey = process.env.PEEKOROBO_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'PEEKOROBO_API_KEY not configured' });
  }

  const teamsParam = req.query.teams;
  if (!teamsParam) {
    return res.status(400).json({ error: 'Missing teams param. Use ?teams=1002,1771' });
  }

  const teamNumbers = teamsParam.split(',').map(t => t.trim()).filter(Boolean);
  if (teamNumbers.length === 0) {
    return res.status(400).json({ error: 'No valid team numbers provided' });
  }

  try {
    const results = await Promise.all(
      teamNumbers.map(async (num) => {
        try {
          const r = await fetch(`https://www.peekorobo.com/api/team_perfs/${num}`, {
            headers: { 'X-Api-Key': apiKey }
          });
          if (!r.ok) return { team_number: num, error: `HTTP ${r.status}` };
          const data = await r.json();
          // Pull the most recent year's perfs (2026)
          const perfs = (data.team_perfs || []).find(p => p.year === 2026) || null;
          return {
            team_number: parseInt(num),
            ace:          perfs?.ace          ?? null,
            raw:          perfs?.raw          ?? null,
            confidence:   perfs?.confidence   ?? null,
            auto_raw:     perfs?.auto_raw     ?? null,
            teleop_raw:   perfs?.teleop_raw   ?? null,
            endgame_raw:  perfs?.endgame_raw  ?? null,
            wins:         perfs?.wins         ?? null,
            losses:       perfs?.losses       ?? null,
            ties:         perfs?.ties         ?? null,
            rank_global:  data.rank_global    ?? null,
            rank_country: data.rank_country   ?? null,
            rank_state:   data.rank_state     ?? null,
            rank_district:data.rank_district  ?? null,
            count_global: data.count_global   ?? null,
            count_state:  data.count_state    ?? null,
            count_district: data.count_district ?? null,
            event_perfs:  perfs?.event_perf   ?? [],
          };
        } catch (e) {
          return { team_number: parseInt(num), error: e.message };
        }
      })
    );

    return res.status(200).json({ teams: results, fetchedAt: Date.now() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
