// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title IdentityAdapter
/// @notice Turns QIE Pass status into two answers: is this wallet a verified person, and which
///         person is it. One person may link up to MAX_WALLETS_PER_PERSON wallets; they share one
///         personHash and count as one person everywhere (leaderboards, host payouts).
/// @dev Mode B (current): Northeside's backend confirms Pass status with QIE, then the attester key
///      signs an EIP-712 attestation that the player submits from their own wallet (or the attester
///      submits directly). This is disclosed as "verified by Northeside using QIE Pass", not as
///      trustless. personHash = keccak256(abi.encode(stablePersonRefFromQIE, pepper)); the raw QIE
///      reference never goes on-chain.
contract IdentityAdapter is AccessControl, EIP712 {
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    uint8 public constant MAX_WALLETS_PER_PERSON = 3;

    bytes32 public constant ATTESTATION_TYPEHASH =
        keccak256("Attestation(address wallet,bytes32 personHash,uint256 nonce,uint64 deadline)");

    mapping(address wallet => bytes32 personHash) public personOf;
    mapping(bytes32 personHash => uint8) public walletCount;
    mapping(address wallet => uint256) public nonces;
    /// @notice Distinct persons with at least one linked wallet.
    uint256 public personCount;

    event Verified(address indexed wallet, bytes32 indexed personHash, address indexed attester);
    event Revoked(address indexed wallet, bytes32 indexed personHash, address indexed by);

    error InvalidParams();
    error AttestationExpired();
    error InvalidAttester(address signer);
    error AlreadyLinked(address wallet);
    error NotLinked(address wallet);
    error TooManyWallets(bytes32 personHash);

    constructor(address admin, address attester) EIP712("Northeside Identity", "1") {
        if (admin == address(0)) revert InvalidParams();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (attester != address(0)) _grantRole(ATTESTER_ROLE, attester);
    }

    /// @notice Link `wallet` to `personHash` with an attestation signed by an attester.
    function submitAttestation(address wallet, bytes32 personHash, uint64 deadline, bytes calldata signature)
        external
    {
        if (block.timestamp > deadline) revert AttestationExpired();
        bytes32 structHash = keccak256(abi.encode(ATTESTATION_TYPEHASH, wallet, personHash, nonces[wallet], deadline));
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (!hasRole(ATTESTER_ROLE, signer)) revert InvalidAttester(signer);
        _link(wallet, personHash, signer);
    }

    /// @notice Direct path for the attester (pays the gas itself).
    function attest(address wallet, bytes32 personHash) external onlyRole(ATTESTER_ROLE) {
        _link(wallet, personHash, msg.sender);
    }

    /// @notice Unlink a wallet (e.g. Pass revoked, or a fraud finding). Invalidates any outstanding
    ///         attestation for it by bumping its nonce.
    function revoke(address wallet) external {
        if (!hasRole(ATTESTER_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, ATTESTER_ROLE);
        }
        bytes32 personHash = personOf[wallet];
        if (personHash == bytes32(0)) revert NotLinked(wallet);

        delete personOf[wallet];
        unchecked {
            ++nonces[wallet];
        }
        uint8 remaining = walletCount[personHash] - 1;
        walletCount[personHash] = remaining;
        if (remaining == 0) --personCount;

        emit Revoked(wallet, personHash, msg.sender);
    }

    function isVerified(address wallet) external view returns (bool) {
        return personOf[wallet] != bytes32(0);
    }

    /// @notice EIP-712 digest the attester signs; exposed so the backend can check its own signer.
    function attestationDigest(address wallet, bytes32 personHash, uint256 nonce, uint64 deadline)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(ATTESTATION_TYPEHASH, wallet, personHash, nonce, deadline)));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _link(address wallet, bytes32 personHash, address attester) private {
        if (wallet == address(0) || personHash == bytes32(0)) revert InvalidParams();
        if (personOf[wallet] != bytes32(0)) revert AlreadyLinked(wallet);
        uint8 count = walletCount[personHash];
        if (count >= MAX_WALLETS_PER_PERSON) revert TooManyWallets(personHash);

        personOf[wallet] = personHash;
        walletCount[personHash] = count + 1;
        unchecked {
            ++nonces[wallet];
        }
        if (count == 0) ++personCount;

        emit Verified(wallet, personHash, attester);
    }
}
