// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title CommitmentLib
/// @notice Canonical encoding of a sealed prediction. Published in docs/COMMITMENTS.md and on the
///         Proof page; packages/commitments reproduces it byte for byte with viem.
/// @dev Chain ID and contract address are inside the hash so a commitment cannot be replayed on
///      another chain or another deployment.
library CommitmentLib {
    /// @notice Hash of a player's score predictions, ordered by fixture index 0..n-1.
    function predictionsHash(uint8[] memory home, uint8[] memory away) internal pure returns (bytes32) {
        return keccak256(abi.encode(home, away));
    }

    /// @notice Payload v2 (scoring rules v2): the Banker fixture index is sealed with the picks.
    ///         `banker` = 255 means no Banker. The deployed contract treats predictionsHash as opaque,
    ///         so v1 and v2 commitments verify the same way on-chain.
    function predictionsHashV2(uint8[] memory home, uint8[] memory away, uint8 banker) internal pure returns (bytes32) {
        return keccak256(abi.encode(home, away, banker));
    }

    function commitment(
        uint256 chainId,
        address matchweeksContract,
        address player,
        uint32 matchweekId,
        bytes32 fixturesRoot,
        bytes32 predictionsHash_,
        bytes32 salt
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(chainId, matchweeksContract, player, matchweekId, fixturesRoot, predictionsHash_, salt)
        );
    }
}
