// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Builds Merkle trees compatible with OpenZeppelin MerkleProof (sorted-pair hashing).
///         Leaves are passed already hashed. The layout differs from StandardMerkleTree, but any
///         tree with sorted-pair hashing verifies the same way on-chain.
library Merkle {
    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function root(bytes32[] memory leaves) internal pure returns (bytes32) {
        require(leaves.length > 0, "empty");
        bytes32[] memory level = leaves;
        while (level.length > 1) {
            level = _next(level);
        }
        return level[0];
    }

    function proof(bytes32[] memory leaves, uint256 index) internal pure returns (bytes32[] memory) {
        require(index < leaves.length, "index");
        bytes32[] memory out = new bytes32[](32);
        uint256 n;
        bytes32[] memory level = leaves;
        uint256 i = index;
        while (level.length > 1) {
            uint256 sibling = i ^ 1;
            if (sibling < level.length) out[n++] = level[sibling];
            level = _next(level);
            i /= 2;
        }
        bytes32[] memory p = new bytes32[](n);
        for (uint256 k = 0; k < n; ++k) {
            p[k] = out[k];
        }
        return p;
    }

    function _next(bytes32[] memory level) private pure returns (bytes32[] memory up) {
        up = new bytes32[]((level.length + 1) / 2);
        for (uint256 i = 0; i < up.length; ++i) {
            uint256 l = 2 * i;
            up[i] = l + 1 < level.length ? hashPair(level[l], level[l + 1]) : level[l];
        }
    }
}
