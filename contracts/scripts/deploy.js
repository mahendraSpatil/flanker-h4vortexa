// Owner: Archit | Deploys RootRegistry from account #0 and writes shared/deployment.json
const fs = require('node:fs');
const path = require('node:path');
const hre = require('hardhat');

// First deployment from account #0 (nonce 0) on a fresh Hardhat chain always lands here.
const FRESH_CHAIN_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const OUTPUT_PATH = path.resolve(__dirname, '..', '..', 'shared', 'deployment.json');

async function main() {
  if (hre.network.name !== 'localhost') {
    throw new Error(
      `Refusing to deploy to "${hre.network.name}": use the running node (npm run deploy).`,
    );
  }

  const [deployer] = await hre.ethers.getSigners();
  const registry = await hre.ethers.deployContract('RootRegistry', deployer);
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  const { chainId } = await hre.ethers.provider.getNetwork();
  const { abi } = await hre.artifacts.readArtifact('RootRegistry');
  // No timestamp: on a fresh chain this file is byte-identical every time, so the committed copy stays clean.
  const deployment = { chainId: Number(chainId), address, abi };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(deployment, null, 2) + '\n');

  console.log(`RootRegistry deployed at ${address} (chainId ${deployment.chainId})`);
  console.log(`Publisher (account #0): ${deployer.address}`);
  console.log(`Wrote ${path.relative(process.cwd(), OUTPUT_PATH)}`);

  if (address !== FRESH_CHAIN_ADDRESS) {
    console.warn(
      `\nWARNING: expected ${FRESH_CHAIN_ADDRESS} on a fresh chain but got ${address}.\n` +
        'The chain was not fresh, so shared/deployment.json now differs from the committed copy.\n' +
        'Run `npm run reset` to start from a clean chain.',
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
