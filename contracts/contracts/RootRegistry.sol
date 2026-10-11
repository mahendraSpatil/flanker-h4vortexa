// Owner: Archit (frozen; ask before changing) | Write-once, publisher-only registry of batch Merkle roots
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RootRegistry {
    address public immutable publisher;

    struct Batch { bytes32 root; uint32 leafCount; uint64 publishedAt; }
    mapping(bytes32 => Batch) private batches;

    event RootPublished(bytes32 indexed batchId, bytes32 root, uint32 leafCount);

    constructor() { publisher = msg.sender; }

    function publishRoot(bytes32 batchId, bytes32 root, uint32 leafCount) external {
        require(msg.sender == publisher, "Not publisher");
        require(root != bytes32(0) && leafCount > 0, "Invalid batch");
        require(batches[batchId].root == bytes32(0), "Batch already published");
        batches[batchId] = Batch(root, leafCount, uint64(block.timestamp));
        emit RootPublished(batchId, root, leafCount);
    }

    function getBatch(bytes32 batchId) external view
        returns (bytes32 root, uint32 leafCount, uint64 publishedAt) {
        Batch memory b = batches[batchId];
        return (b.root, b.leafCount, b.publishedAt);
    }
}
