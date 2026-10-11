// Owner: Archit | RootRegistry tests: publish, write-once, publisher-only, zero root, unknown batch
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

const BATCH_ID = ethers.encodeBytes32String('BATCH-0001');
const ROOT = ethers.id('proofchain test root');
const LEAF_COUNT = 4;

async function deployFixture() {
  const [publisher, outsider] = await ethers.getSigners();
  const registry = await ethers.deployContract('RootRegistry', publisher);
  return { registry, publisher, outsider };
}

describe('RootRegistry', function () {
  it('lets the publisher publish a root and reads it back', async function () {
    const { registry, publisher } = await loadFixture(deployFixture);

    expect(await registry.publisher()).to.equal(publisher.address);
    await expect(registry.publishRoot(BATCH_ID, ROOT, LEAF_COUNT))
      .to.emit(registry, 'RootPublished')
      .withArgs(BATCH_ID, ROOT, LEAF_COUNT);

    const [root, leafCount, publishedAt] = await registry.getBatch(BATCH_ID);
    expect(root).to.equal(ROOT);
    expect(leafCount).to.equal(LEAF_COUNT);
    expect(publishedAt).to.be.greaterThan(0n);
  });

  it('refuses to overwrite a published batch', async function () {
    const { registry } = await loadFixture(deployFixture);
    await registry.publishRoot(BATCH_ID, ROOT, LEAF_COUNT);

    await expect(
      registry.publishRoot(BATCH_ID, ethers.id('replacement root'), LEAF_COUNT),
    ).to.be.revertedWith('Batch already published');
  });

  it('refuses a publish from anyone but the publisher', async function () {
    const { registry, outsider } = await loadFixture(deployFixture);

    await expect(
      registry.connect(outsider).publishRoot(BATCH_ID, ROOT, LEAF_COUNT),
    ).to.be.revertedWith('Not publisher');
  });

  it('refuses a zero root or a zero leafCount', async function () {
    const { registry } = await loadFixture(deployFixture);

    await expect(registry.publishRoot(BATCH_ID, ethers.ZeroHash, LEAF_COUNT)).to.be.revertedWith(
      'Invalid batch',
    );
    await expect(registry.publishRoot(BATCH_ID, ROOT, 0)).to.be.revertedWith('Invalid batch');
  });

  it('returns a zero root for an unknown batchId', async function () {
    const { registry } = await loadFixture(deployFixture);

    const [root, leafCount, publishedAt] = await registry.getBatch(
      ethers.encodeBytes32String('BATCH-9999'),
    );
    expect(root).to.equal(ethers.ZeroHash);
    expect(leafCount).to.equal(0n);
    expect(publishedAt).to.equal(0n);
  });
});
