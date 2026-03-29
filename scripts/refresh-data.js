#!/usr/bin/env node
/**
 * CR Analytics — TBA Data Refresh Script
 * ---------------------------------------
 * Run:  node scripts/refresh-data.js YOUR_TBA_API_KEY
 *   or: TBA_KEY=yourkey node scripts/refresh-data.js
 *
 * Fetches all match, ranking, and alliance data for all 6 PCH 2026 events
 * and writes public/data.json. Commit and push that file to redeploy.
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EVENTS = [
  { key: '2026gadal', short: 'DAL', name: 'Dalton',          week: 1 },
  { key: '2026gagwi', short: 'GWI', name: 'Gwinnett',        week: 2 },
  { key: '2026gacol', short: 'COL', name: 'Columbus',        week: 3 },
  { key: '2026gaalb', short: 'ALB', name: 'Albany',          week: 4 },
  { key: '2026gagai', short: 'GAI', name: 'Gainesville',     week: 5 },
  { key: '2026gacmp', short: 'CMP', name: 'District Champs', week: 6 },
];

const TBA_KEY = process.argv[2] || process.env.TBA_KEY;

if (!TBA_KEY) {
  console.error('❌  No TBA API key provided.');
  console.error('    Usage: node scripts/refresh-data.js YOUR_KEY');
  process.exit(1);
}

async function tbaFetch(path) {
  const url = `https://www.thebluealliance.com/api/v3${path}`;
  const res = await fetch(url, { headers: { 'X-TBA-Auth-Key': TBA_KEY } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  console.log('🔄  Fetching 2026 FRC data from The Blue Alliance...\n');

  const output = {
    fetchedAt: new Date().toISOString(),
    events: {},
    districtRankings: [],
    teams: {},
  };

  for (const ev of EVENTS) {
    process.stdout.write(`  ⏳  ${ev.name} (${ev.short})...`);
    try {
      const [matches, rankings, alliances] = await Promise.all([
        tbaFetch(`/event/${ev.key}/matches`),
        tbaFetch(`/event/${ev.key}/rankings`),
        tbaFetch(`/event/${ev.key}/alliances`),
      ]);
      output.events[ev.key] = {
        meta: ev,
        matches: matches || [],
        rankings: rankings || {},
        alliances: alliances || [],
      };
      console.log(` ✅  ${(matches || []).length} matches`);
    } catch (e) {
      console.log(` ⚠️   No data yet (${e.message})`);
      output.events[ev.key] = { meta: ev, matches: [], rankings: {}, alliances: [] };
    }
  }

  process.stdout.write('\n  ⏳  District rankings...');
  try {
    output.districtRankings = await tbaFetch('/district/2026pch/rankings') || [];
    console.log(` ✅  ${output.districtRankings.length} teams ranked`);
  } catch (e) {
    console.log(` ⚠️   ${e.message}`);
  }

  const teamKeys = new Set();
  Object.values(output.events).forEach(ev => {
    (ev.matches || []).forEach(m => {
      (m.alliances?.red?.team_keys || []).forEach(k => teamKeys.add(k));
      (m.alliances?.blue?.team_keys || []).forEach(k => teamKeys.add(k));
    });
  });

  process.stdout.write(`\n  ⏳  Team info (${teamKeys.size} teams)...`);
  const teamArr = [...teamKeys];
  for (let i = 0; i < teamArr.length; i += 10) {
    await Promise.all(teamArr.slice(i, i + 10).map(async k => {
      try { output.teams[k] = await tbaFetch(`/team/${k}/simple`); } catch (e) {}
    }));
  }
  console.log(` ✅  ${Object.keys(output.teams).length} teams loaded`);

  const outPath = path.join(__dirname, '..', 'public', 'data.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  const sizeKB = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`\n✅  Written to public/data.json (${sizeKB} KB)`);
  console.log('\n📋  Next steps:');
  console.log('    git add public/data.json');
  console.log('    git commit -m "refresh data"');
  console.log('    git push\n');
}

main().catch(err => {
  console.error('\n❌  Fatal error:', err.message);
  process.exit(1);
});
