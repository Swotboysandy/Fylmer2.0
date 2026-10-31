import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function runOrca(cmd) {
  try {
    const raw = execSync(`orca ${cmd}`, { encoding: 'utf8', timeout: 30000 });
    return raw.trim();
  } catch (err) {
    return (err.stdout || err.message || '').trim();
  }
}

function runOrcaJson(cmd) {
  const text = runOrca(`${cmd} --json`);
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, raw: text };
  }
}

async function audit() {
  console.log('=== Orca Browser Diagnostic & Tracking Audit ===\n');

  // 1. Verify Orca status
  console.log('1. Checking Orca runtime status...');
  const statusRes = runOrcaJson('status');
  if (!statusRes.ok || statusRes.result?.runtime?.state !== 'ready') {
    console.error('Orca runtime is not ready. Run `orca open` first.');
    process.exit(1);
  }
  console.log('   Orca runtime is READY (App PID:', statusRes.result?.app?.pid, ')\n');

  // 2. Discover or create tab
  console.log('2. Connecting to local app tab (http://127.0.0.1:4317)...');
  const tabsRes = runOrcaJson('tab list');
  let pageId = null;

  if (tabsRes.ok && Array.isArray(tabsRes.result?.tabs)) {
    const existing = tabsRes.result.tabs.find(t => t.url && t.url.includes('127.0.0.1:4317'));
    if (existing) {
      pageId = existing.browserPageId;
      console.log('   Found existing tab:', pageId);
    }
  }

  if (!pageId) {
    console.log('   Creating new tab...');
    const createRes = runOrcaJson('tab create --url http://127.0.0.1:4317');
    if (!createRes.ok || !createRes.result?.browserPageId) {
      console.error('Failed to create Orca tab:', createRes);
      process.exit(1);
    }
    pageId = createRes.result.browserPageId;
    console.log('   Created tab:', pageId);
    // Give page 2 seconds to load
    await new Promise(r => setTimeout(r, 2000));
  }

  // 3. Page Accessibility Snapshot
  console.log('3. Inspecting DOM via Orca Accessibility Snapshot...');
  const snapshotText = runOrca(`snapshot --page ${pageId}`);
  const hasAnchorshot = snapshotText.includes('anchorshot');
  const hasDirector = snapshotText.includes("DIRECTOR'S CHAIR") || snapshotText.includes("Director");
  console.log('   Title / Brand found:', hasAnchorshot ? 'YES' : 'NO');
  console.log('   Director interface ready:', hasDirector ? 'YES' : 'NO\n');

  // 4. Query in-browser Orca Tracker
  console.log('4. Querying window.__ORCA_TRACKER__ telemetry...');
  const trackerDump = runOrca(`eval --page ${pageId} --expression "window.__ORCA_TRACKER__ ? window.__ORCA_TRACKER__.dump() : 'NOT_FOUND'"`);

  let trackerData = null;
  try {
    trackerData = JSON.parse(trackerDump);
  } catch {
    console.log('   Tracker raw output:', trackerDump.slice(0, 200));
  }

  if (trackerData && trackerData.summary) {
    console.log('   Summary:');
    console.log('     Total logs:', trackerData.summary.totalLogs);
    console.log('     Network calls:', trackerData.summary.networkCalls);
    console.log('     Error count:', trackerData.summary.errorCount);
    if (trackerData.summary.errorCount > 0) {
      console.log('\n   [!] Errors detected by Orca Tracker:');
      for (const err of trackerData.recentErrors) {
        console.log(`     - [${err.category}] ${err.message}`);
      }
    } else {
      console.log('   [+] 0 errors detected. Application is healthy!');
    }
  }

  // 5. Capture Viewport Screenshot
  console.log('\n5. Capturing Viewport Screenshot via Orca...');
  const screenshotRes = runOrcaJson(`screenshot --page ${pageId} --format png`);
  if (screenshotRes.ok && screenshotRes.result?.screenshotPath) {
    console.log('   Screenshot saved to:', screenshotRes.result.screenshotPath);
  } else {
    console.log('   Screenshot output:', screenshotRes);
  }

  console.log('\n=== Audit Complete ===');
}

audit().catch(console.error);
