// Owner: Archit (frozen; ask before changing) | Hardhat 2 config: compiler and the local chain (chainId 31337)
const fs = require('node:fs');
const { task } = require('hardhat/config');
const { TASK_TEST } = require('hardhat/builtin-tasks/task-names');
require('@nomicfoundation/hardhat-toolbox');

// Under scripts/test.js, record mocha's failure count before Hardhat exits, so a crash while the
// process shuts down is not mistaken for failing tests (see scripts/test.js)
task(TASK_TEST).setAction(async (args, hre, runSuper) => {
  const failures = await runSuper(args);
  const resultFile = process.env.PROOFCHAIN_TEST_RESULT_FILE;
  if (resultFile) fs.writeFileSync(resultFile, String(failures));
  return failures;
});

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: '0.8.20',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    localhost: { url: 'http://127.0.0.1:8545', chainId: 31337 },
  },
};
