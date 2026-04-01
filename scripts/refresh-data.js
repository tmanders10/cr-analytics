#!/usr/bin/env node
/**
 * CR Analytics — TBA + Statbotics Data Refresh Script
 * -----------------------------------------------------
 * Smart refresh: only fetches TBA data for active/upcoming events.
 * Completed events reuse existing data.json values.
 * EPA always refreshes for all events (Statbotics updates historical data).
 *
 * Run:  node scripts/refresh-data.js YOUR_TBA_API_KEY
 *   or: TBA_KEY=yourkey node scripts/refresh-data.js
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Event dates are the Saturday of each event weekend (end date)
// Fetch window: start fetching 2 days before, treat as complete 2 days after end
const EVENTS = [
  { key: '2026gadal', short: 'DAL', name: 'Dalton',          week: 1, start: '2026-02-27', end: '2026-03-01' },
  { key: '2026gagwi', short: 'GWI', name: 'Gwinnett',        week: 2, start: '2026-03-06', end: '2026-03-08' },
  { key: '2026gacol', short: 'COL', name: 'Columbus',        week: 3, start: '2026-03-13', end: '2026-03-15' },
  { key: '2026gaalb', short: 'ALB', name: 'Albany',          week: 4, start: '2026-03-20', end: '2026-03-22' },
  { key: '2026gagai', short: 'GAI', name: 'Gainesville',     week: 5, start: '2026-04-02', end: '2026-04-04' },
  { key: '2026gacmp', short: 'CMP', name: 'District Champs', week: 6, start: '2026-04-08', end: '2026-04-11' },
];

// How to classify each event relative to today
function eventStatus(ev) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(ev.start);
  const end   = new Date(ev.end);
  // Add 2-day grace period after end before treating as "complete"
  const grace = new Date(end);
  grace.setDate(grace.getDate() + 2);

  if (today > grace)  return 'complete';   // finished + grace period passed
  if (today >= start) return 'active';     // currently happening
  return 'upcoming';                       // hasn't started yet
}

const TBA_KEY = process.argv[2] || process.env.TBA_KEY;

if (!TBA_KEY) {
  console.error('No TBA API key provided.');
  console.error('Usage: node scripts/refresh-data.js YOUR_KEY');
  process.exit(1);
}

async function tbaFetch(endpoint) {
  const url = `https://www.thebluealliance.com/api/v3${endpoint}`;
  const res = await fetch(url, { headers: { 'X-TBA-Auth-Key': TBA_KEY } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function statboticsFetch(endpoint) {
  const url = `https://api.statbotics.io/v3${endpoint}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

async function main() {
  // Load existing data.json to preserve completed event data
  const outPath = path.join(__dirname, '..', 'public', 'data.json');
  let existing = { events: {}, districtRankings: [], teams: {}, epa: {} };
  if (fs.existsSync(outPath)) {
    try { existing = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (e) {}
  }

  const output = {
    fetchedAt: new Date().toISOString(),
    events: {},
    districtRankings: existing.districtRankings || [],
    teams: existing.teams || {},
    epa: existing.epa || {},
  };

  console.log('Fetching 2026 FRC data (smart refresh)...\n');
  console.log('The Blue Alliance:');

  let fetchedCount = 0, skippedCount = 0;

  for (const ev of EVENTS) {
    const status = eventStatus(ev);
    process.stdout.write(`  ... ${ev.name} (${ev.short}) [${status}]`);

    if (status === 'complete' && existing.events?.[ev.key]?.matches?.length > 0) {
      // Reuse existing data — event is done and we already have it
      output.events[ev.key] = existing.events[ev.key];
      console.log(` -> skipped (${existing.events[ev.key].matches.length} matches cached)`);
      skippedCount++;
      continue;
    }

    // Fetch fresh data for active/upcoming events (or completed events with no cached data)
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
      console.log(` -> ${(matches || []).length} matches`);
      fetchedCount++;
    } catch (e) {
      console.log(` -> No data yet (${e.message})`);
      output.events[ev.key] = existing.events?.[ev.key] ||
        { meta: ev, matches: [], rankings: {}, alliances: [] };
    }
  }

  console.log(`\n  ${fetchedCount} event(s) fetched, ${skippedCount} skipped (cached)`);

  // District rankings — always refresh
  process.stdout.write('\n  ... District rankings');
  try {
    output.districtRankings = await tbaFetch('/district/2026pch/rankings') || [];
    console.log(` -> ${output.districtRankings.length} teams`);
  } catch (e) {
    console.log(` -> ${e.message} (using cached)`);
  }

  // Team info — only fetch teams we don't already have
  const teamKeys = new Set();
  Object.values(output.events).forEach(ev => {
    (ev.matches || []).forEach(m => {
      (m.alliances?.red?.team_keys  || []).forEach(k => teamKeys.add(k));
      (m.alliances?.blue?.team_keys || []).forEach(k => teamKeys.add(k));
    });
  });
  const newTeams = [...teamKeys].filter(k => !output.teams[k]);
  if (newTeams.length > 0) {
    process.stdout.write(`\n  ... Team info (${newTeams.length} new teams)`);
    for (let i = 0; i < newTeams.length; i += 10) {
      await Promise.all(newTeams.slice(i, i + 10).map(async k => {
        try { output.teams[k] = await tbaFetch(`/team/${k}/simple`); } catch (e) {}
      }));
    }
    console.log(` -> done`);
  } else {
    console.log(`\n  ... Team info -> all ${teamKeys.size} teams cached`);
  }

  // Statbotics EPA — always refresh all events (historical EPA updates)
  console.log('\nStatbotics EPA:');
  for (const ev of EVENTS) {
    const status = eventStatus(ev);
    // Skip upcoming events with no matches yet
    if (status === 'upcoming' && !existing.events?.[ev.key]?.matches?.length) {
      console.log(`  ... ${ev.name} (${ev.short}) -> skipped (upcoming)`);
      continue;
    }
    process.stdout.write(`  ... ${ev.name} (${ev.short})`);
    try {
      const records = await statboticsFetch(`/team_events?event=${ev.key}&limit=100`);
      if (!Array.isArray(records) || records.length === 0) {
        console.log(` -> No EPA data yet`);
        continue;
      }
      let count = 0;
      records.forEach(record => {
        const teamKey = `frc${record.team}`;
        if (!output.epa[teamKey]) output.epa[teamKey] = {};
        const epa = extractEPA(record);
        if (epa) { output.epa[teamKey][ev.key] = epa; count++; }
      });
      console.log(` -> ${count} team EPAs`);
    } catch (e) {
      console.log(` -> ${e.message}`);
    }
  }

  // Write
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  const sizeKB = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`\nWritten to public/data.json (${sizeKB} KB)`);
  console.log(`Teams with EPA: ${Object.keys(output.epa).length}`);
  console.log('\nNext steps:');
  console.log('  copy public\\data.json data.json');
  console.log('  git add public/data.json data.json');
  console.log('  git commit -m "refresh data"');
  console.log('  git push\n');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
