// Owner: Archit | Runs `hardhat test` and exits with the tests' real result
//
// On Windows + Node 24, Hardhat can abort after mocha has finished (libuv assertion in
// src\win\async.c during process teardown), so a green run exits non-zero. Mocha's `exit` option
// does not help: Hardhat runs mocha programmatically and already calls process.exit itself.
// Instead the child records mocha's failure count (hardhat.config.js) before it exits, and a
// non-zero exit is overridden only when that count was recorded and is 0. Failing tests, compile
// errors and crashes before the count is written all keep the child's exit code.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HARDHAT_CLI = require.resolve('hardhat/internal/cli/bootstrap.js');
const resultFile = path.join(os.tmpdir(), `proofchain-hardhat-test-${process.pid}.txt`);

/** Failure count the child recorded, or null if it never got that far. Removes the file. */
function readFailures() {
  try {
    const text = fs.readFileSync(resultFile, 'utf8').trim();
    return /^\d+$/.test(text) ? Number(text) : null;
  } catch {
    return null;
  } finally {
    fs.rmSync(resultFile, { force: true });
  }
}

fs.rmSync(resultFile, { force: true });
const child = spawnSync(process.execPath, [HARDHAT_CLI, 'test', ...process.argv.slice(2)], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env: { ...process.env, PROOFCHAIN_TEST_RESULT_FILE: resultFile },
});
const failures = readFailures();

if (child.error) {
  console.error(child.error);
  process.exit(1);
}
const code = child.status ?? 1;
if (code !== 0 && failures === 0) {
  const how = child.signal ? `signal ${child.signal}` : `exit code ${code}`;
  console.warn(
    `\nAll tests passed, but Hardhat crashed while exiting (${how}); reporting success.`,
  );
  process.exit(0);
}
process.exit(code);
