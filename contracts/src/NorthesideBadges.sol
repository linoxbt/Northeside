// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title NorthesideBadges
/// @notice Non-transferable (soulbound) achievement badges for Northeside players, e.g. "Sniper"
///         (an exact score) or "Upset caller". Each badge is earned from on-chain play (sealed
///         commitments, published reveals and results) and is computed off-chain by the same code
///         that scores matchweeks. The operator posts a Merkle root of every (wallet, badgeId) earned
///         so far; each player mints their own badge from their own wallet.
/// @dev Badges carry no value: they cannot be transferred, approved, sold or redeemed, and nothing
///      in Northeside pays out on them. Holders may burn their own badge; a burned badge cannot be
///      claimed again.
///
///      Trust model: the OPERATOR decides who is in a root. A wrong root can be revoked by the
///      admin before or after claims; badges already minted from it stay (holders can burn them).
///      Roots are cumulative, so any live root lists every badge earned up to its posting.
contract NorthesideBadges is ERC1155, AccessControl, Pausable {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    string public constant name = "Northeside Badges";
    string public constant symbol = "NSBADGE";

    /// @notice Highest badge id that can exist (ids are 1..MAX_BADGE_ID).
    uint256 public constant MAX_BADGE_ID = 255;

    /// @notice Posted roots by round (1-based); revoked roots stay listed but cannot be claimed against.
    mapping(uint256 round => bytes32 root) public roots;
    mapping(uint256 round => bool revoked) public revokedRound;
    uint256 public rounds;

    /// @notice Whether a wallet has ever minted a badge (burning does not reset it).
    mapping(address player => mapping(uint256 badgeId => bool)) public claimed;

    string private _base;

    event RootPosted(uint256 indexed round, bytes32 root);
    event RootRevoked(uint256 indexed round);
    event BadgeClaimed(address indexed player, uint256 indexed badgeId, uint256 indexed round);
    event BaseURIChanged(string baseURI);

    error Soulbound();
    error ZeroRoot();
    error UnknownRound(uint256 round);
    error Revoked(uint256 round);
    error BadBadge(uint256 badgeId);
    error AlreadyClaimed(address player, uint256 badgeId);
    error InvalidProof();

    constructor(address admin, address operator, address pauser, string memory baseURI) ERC1155("") {
        require(admin != address(0) && operator != address(0) && pauser != address(0), "zero address");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, operator);
        _grantRole(PAUSER_ROLE, pauser);
        _base = baseURI;
    }

    // ------------------------------------------------------------------ roots

    /// @notice Post the cumulative root of every (wallet, badgeId) earned so far.
    function postRoot(bytes32 root) external onlyRole(OPERATOR_ROLE) whenNotPaused returns (uint256 round) {
        if (root == bytes32(0)) revert ZeroRoot();
        round = ++rounds;
        roots[round] = root;
        emit RootPosted(round, root);
    }

    /// @notice Stop claims against a wrongly posted root.
    function revokeRoot(uint256 round) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (round == 0 || round > rounds) revert UnknownRound(round);
        revokedRound[round] = true;
        emit RootRevoked(round);
    }

    // ------------------------------------------------------------------ claims

    /// @notice Leaf for (wallet, badgeId); OpenZeppelin StandardMerkleTree encoding (double hash).
    function leafHash(address player, uint8 badgeId) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(player, badgeId))));
    }

    /// @notice Mint a badge you earned, from your own wallet, with a proof against a live root.
    function claim(uint256 round, uint8 badgeId, bytes32[] calldata proof) external whenNotPaused {
        if (badgeId == 0) revert BadBadge(badgeId);
        if (round == 0 || round > rounds) revert UnknownRound(round);
        if (revokedRound[round]) revert Revoked(round);
        if (claimed[msg.sender][badgeId]) revert AlreadyClaimed(msg.sender, badgeId);
        if (!MerkleProof.verifyCalldata(proof, roots[round], leafHash(msg.sender, badgeId))) revert InvalidProof();
        claimed[msg.sender][badgeId] = true;
        emit BadgeClaimed(msg.sender, badgeId, round);
        _mint(msg.sender, badgeId, 1, "");
    }

    /// @notice Burn one of your own badges (it cannot be claimed again).
    function burn(uint256 badgeId) external {
        _burn(msg.sender, badgeId, 1);
    }

    // ------------------------------------------------------------------ soulbound

    /// @dev Only mints (from zero) and burns (to zero); every transfer reverts.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        if (from != address(0) && to != address(0)) revert Soulbound();
        super._update(from, to, ids, values);
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    // ------------------------------------------------------------------ metadata and admin

    /// @notice Metadata URL: base + decimal id, e.g. https://example.app/api/v1/badges/5
    function uri(uint256 badgeId) public view override returns (string memory) {
        if (badgeId == 0 || badgeId > MAX_BADGE_ID) revert BadBadge(badgeId);
        return string.concat(_base, Strings.toString(badgeId));
    }

    function setBaseURI(string calldata baseURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _base = baseURI;
        emit BaseURIChanged(baseURI);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Only the admin can resume (a compromised pauser cannot undo an emergency stop).
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
