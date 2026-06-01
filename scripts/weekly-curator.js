#!/usr/bin/env node

import fs from 'node:fs';
import {
  CONFIG_PATH,
  loadConfigFromFile,
  runWeeklyCurator,
  writeWeeklyBundle,
} from './lib/weekly-curator-core.mjs';
import {
  assignBundleToWeek,
  deployBundleToLiveApp,
  persistCuratorResult,
  loadBundleJson,
} from './lib/weekly-schedule.mjs';
import { getIsoWeekKey } from '../api/_lib/period.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  UmpForTheTest — Weekly Challenge Curator');
  console.log('═══════════════════════════════════════════════════════');

  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      throw new Error(`Missing config: ${CONFIG_PATH}`);
    }
    const config = loadConfigFromFile(CONFIG_PATH);
    const weekId = config.scheduleForWeekId || getIsoWeekKey();

    console.log(`\n📋 Config: ${config.label}`);
    console.log(`   Week: ${weekId} · Games: ${config.games.count} · Playlist: ${config.playlist.targetAtBats} ABs`);

    const result = await runWeeklyCurator(config, { log: true });
    const { bundle } = await persistCuratorResult(result, {
      label: config.label || `Bundle ${weekId}`,
      bundleId: `bundle-${weekId}`,
    });

    writeWeeklyBundle(result.games, result.meta);
    await assignBundleToWeek(weekId, bundle.id);

    const current = getIsoWeekKey();
    if (weekId === current) {
      const full = await loadBundleJson(bundle.id);
      const deploy = deployBundleToLiveApp(full);
      if (deploy.published) console.log('\n📡 Deployed to live weekly_challenge.js');
    }

    console.log(`\n📊 Playlist: ${result.playlistStats.selectedAbs}/${result.playlistStats.targetAtBats} ABs`);
    console.log(`📦 Bundle id: ${bundle.id}`);
    console.log('\n✅ Weekly curator completed successfully!\n');
  } catch (err) {
    console.error(`\n❌ Fatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
