import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','tests/browser/cup.spec.ts','tests/browser/dream.spec.ts','tests/browser/samCup.spec.ts','tests/browser/twoAnchors.spec.ts'],{stdio:'inherit'});
process.exit(result.status ?? 1);
