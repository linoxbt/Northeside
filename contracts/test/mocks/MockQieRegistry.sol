// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Test double for the QIE ID name registry's two read functions Northeside uses:
///         reverse lookup (wallet -> .qie name) and forward lookup (name -> owner).
contract MockQieRegistry {
    mapping(address => string) public userDomain;
    mapping(string => address) private _owner;

    function setName(address wallet, string calldata name) external {
        userDomain[wallet] = name;
        _owner[name] = wallet;
    }

    /// @dev Lets a test make a reverse record stale (the name now belongs to someone else).
    function setOwner(string calldata name, address owner) external {
        _owner[name] = owner;
    }

    function resolver(string calldata name) external view returns (uint256 tokenId, address owner) {
        owner = _owner[name];
        tokenId = owner == address(0) ? 0 : uint256(keccak256(bytes(name)));
    }
}
