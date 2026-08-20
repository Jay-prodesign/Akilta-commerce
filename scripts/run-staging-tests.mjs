import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url).pathname;
const build = join(root, '.staging-build');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

rmSync(build, { recursive: true, force: true });
run('tsc', ['-p', 'tsconfig.plain-tests.json']);
writeFileSync(join(build, 'package.json'), '{"type":"commonjs"}\n');

let executed = 0;
const testRoots = [join(build, 'tests', 'contract'), join(build, 'tests', 'security')];
for (const dir of testRoots) {
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.spec.js')).sort()) {
    run('node', [join(dir, file)]);
    executed += 1;
  }
}
run('node', [join(root, 'tests', 'contract', 'schema-migration.spec.mjs')]);
executed += 1;
run('node', [join(root, 'tests', 'contract', 'schema-migration-0002.spec.mjs')]);
executed += 1;
run('node', [join(root, 'tests', 'contract', 'p0-026-source-safety.spec.mjs')]);
executed += 1;
run('node', [join(root, 'tests', 'contract', 'schema-migration-0003.spec.mjs')]);
executed += 1;
console.log(`STAGING_DEPENDENCY_FREE_SUITE_PASS ${executed}/${executed}`);
console.log('RUNTIME_DEPENDENCY_TESTS_NOT_RUN: hono/vitest/wrangler/workerd/postgres/provider adapters require real install/runtime evidence.');
