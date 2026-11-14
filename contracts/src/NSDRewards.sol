// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {INorthesideMatchweeks} from "./interfaces/INorthesideMatchweeks.sol";

/// @notice The part of IdentityAdapter this contract reads: which person a wallet is verified as.
interface IPersonRegistry {
    function personOf(address wallet) external view returns (bytes32);
}

/// @title NSDRewards
/// @notice Weekly $NSD rewards for top players. After a matchweek is finalized on-chain, the
///         operator posts one Merkle root of (matchweek, wallet, amount), computed off-chain from the
///         final table. After a 24-hour review delay, each listed wallet can claim within 90 days.
/// @dev Anti-farming is enforced here, not only off-chain: a claim needs the wallet to be verified
///      in the IdentityAdapter (one person), and each person can claim at most once per matchweek,
///      however many of their wallets appear in a root. Tokens always go to the listed wallet.
///
///      Trust model, stated plainly: the OPERATOR decides who is in a root, so a compromised
///      operator could list its own verified wallet, up to `maxPerMatchweek` per matchweek.
///      Mitigations: the CLAIM_DELAY review window (the admin can voidRoot, the operator
///      replaceRoot, any root nobody has claimed from), the per-matchweek cap, admin-only unpause,
///      and role revocation.
///
///      Accounting: outstanding = sum over live roots of (allocated - claimed). A root can only
///      allocate tokens the contract holds beyond what is outstanding, so every listed claim is
///      always payable.
contract NSDRewards is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice A posted root can be claimed against only after this review delay.
    uint64 public constant CLAIM_DELAY = 24 hours;
    /// @notice After the review delay, claims stay open this long; then the rest returns to the pool.
    uint64 public constant CLAIM_WINDOW = 90 days;

    IERC20 public immutable token;
    INorthesideMatchweeks public immutable matchweeks;
    IPersonRegistry public immutable identity;

    /// @notice Most a single matchweek's root may allocate (bounds a compromised operator).
    uint128 public maxPerMatchweek;
    /// @notice Allocated to live roots and not yet claimed or released.
    uint128 public outstanding;

    struct Root {
        bytes32 root;
        uint64 postedAt;
        bool released;
        uint128 allocated;
        uint128 claimed;
    }

    mapping(uint32 matchweekId => Root) private _roots;
    mapping(bytes32 leaf => bool) public leafClaimed;
    mapping(uint32 matchweekId => mapping(bytes32 personHash => bool)) public personClaimed;

    event RootPosted(uint32 indexed matchweekId, bytes32 root, uint128 total, string reportURI);
    event RootReplaced(uint32 indexed matchweekId, bytes32 oldRoot, bytes32 root, uint128 total, string reportURI);
    event RootVoided(uint32 indexed matchweekId, bytes32 oldRoot, uint128 released);
    event Released(uint32 indexed matchweekId, uint128 amount);
    event Claimed(uint32 indexed matchweekId, address indexed wallet, bytes32 indexed personHash, uint128 amount);
    event MaxPerMatchweekSet(uint128 amount);
    event Withdrawn(address indexed to, uint128 amount);

    error InvalidParams();
    error NotFinalized(uint32 matchweekId);
    error RootExists(uint32 matchweekId);
    error NoRoot(uint32 matchweekId);
    error OverCap();
    error InsufficientPool();
    error AlreadyClaimedFrom(uint32 matchweekId);
    error ClaimNotOpen(uint32 matchweekId);
    error ClaimWindowOver(uint32 matchweekId);
    error ClaimWindowOpen(uint32 matchweekId);
    error NotVerified(address wallet);
    error PersonAlreadyClaimed(uint32 matchweekId);
    error AlreadyClaimed();
    error InvalidProof();

    constructor(
        address admin,
        address operator,
        address pauser,
        IERC20 token_,
        INorthesideMatchweeks matchweeks_,
        IPersonRegistry identity_,
        uint128 maxPerMatchweek_
    ) {
        if (
            admin == address(0) || operator == address(0) || pauser == address(0) || address(token_) == address(0)
                || address(matchweeks_) == address(0) || address(identity_) == address(0) || maxPerMatchweek_ == 0
        ) revert InvalidParams();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, operator);
        _grantRole(PAUSER_ROLE, pauser);
        token = token_;
        matchweeks = matchweeks_;
        identity = identity_;
        maxPerMatchweek = maxPerMatchweek_;
        emit MaxPerMatchweekSet(maxPerMatchweek_);
    }

    // ---------------------------------------------------------------- views

    function rootOf(uint32 matchweekId) external view returns (Root memory) {
        return _roots[matchweekId];
    }

    /// @notice Tokens a new root may allocate: the balance beyond what is already outstanding.
    function available() public view returns (uint256) {
        uint256 bal = token.balanceOf(address(this));
        return bal > outstanding ? bal - outstanding : 0;
    }

    function claimOpensAt(uint32 matchweekId) public view returns (uint64) {
        return _roots[matchweekId].postedAt + CLAIM_DELAY;
    }

    function claimClosesAt(uint32 matchweekId) public view returns (uint64) {
        return _roots[matchweekId].postedAt + CLAIM_DELAY + CLAIM_WINDOW;
    }

    function leafHash(uint32 matchweekId, address wallet, uint128 amount) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(matchweekId, wallet, amount))));
    }

    // ---------------------------------------------------------------- operator

    /// @notice Post a finalized matchweek's reward root. `total` is the sum of every leaf amount.
    function postRoot(uint32 matchweekId, bytes32 root, uint128 total, string calldata reportURI)
        external
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
    {
        if (root == bytes32(0) || total == 0 || bytes(reportURI).length == 0) revert InvalidParams();
        if (!matchweeks.isFinalized(matchweekId)) revert NotFinalized(matchweekId);
        Root storage r = _roots[matchweekId];
        if (r.root != bytes32(0) || r.released) revert RootExists(matchweekId);
        if (total > maxPerMatchweek) revert OverCap();
        if (total > available()) revert InsufficientPool();

        r.root = root;
        r.postedAt = uint64(block.timestamp);
        r.allocated = total;
        outstanding += total;
        emit RootPosted(matchweekId, root, total, reportURI);
    }

    /// @notice Correct a root nobody has claimed from yet. Restarts the review delay.
    function replaceRoot(uint32 matchweekId, bytes32 root, uint128 total, string calldata reportURI)
        external
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
    {
        if (root == bytes32(0) || total == 0 || bytes(reportURI).length == 0) revert InvalidParams();
        Root storage r = _roots[matchweekId];
        if (r.root == bytes32(0) || r.released) revert NoRoot(matchweekId);
        if (r.claimed != 0) revert AlreadyClaimedFrom(matchweekId);
        if (root == r.root) revert InvalidParams();
        if (total > maxPerMatchweek) revert OverCap();
        // The old allocation is freed first, so the new one may reuse it.
        if (total > available() + r.allocated) revert InsufficientPool();

        bytes32 old = r.root;
        outstanding = outstanding - r.allocated + total;
        r.root = root;
        r.postedAt = uint64(block.timestamp);
        r.allocated = total;
        emit RootReplaced(matchweekId, old, root, total, reportURI);
    }

    // ---------------------------------------------------------------- admin

    /// @notice Backstop for a bad root nobody has claimed from: removes it and frees its allocation.
    ///         Works while paused. The matchweek can then get a fresh root.
    function voidRoot(uint32 matchweekId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Root storage r = _roots[matchweekId];
        if (r.root == bytes32(0) || r.released) revert NoRoot(matchweekId);
        if (r.claimed != 0) revert AlreadyClaimedFrom(matchweekId);
        bytes32 old = r.root;
        uint128 freed = r.allocated;
        outstanding -= freed;
        delete _roots[matchweekId];
        emit RootVoided(matchweekId, old, freed);
    }

    function setMaxPerMatchweek(uint128 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (amount == 0) revert InvalidParams();
        maxPerMatchweek = amount;
        emit MaxPerMatchweekSet(amount);
    }

    /// @notice Move tokens that are not owed to anyone (never outstanding claims) out of the pool.
    function withdrawAvailable(address to, uint128 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0) || amount == 0) revert InvalidParams();
        if (amount > available()) revert InsufficientPool();
        token.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Only the admin can lift a pause, so a leaked pauser key cannot undo an emergency stop.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------- players

    /// @notice Claim a wallet's reward for one matchweek. Anyone may submit; tokens go to `wallet`.
    function claim(uint32 matchweekId, address wallet, uint128 amount, bytes32[] calldata proof)
        external
        nonReentrant
        whenNotPaused
    {
        if (wallet == address(0) || amount == 0) revert InvalidParams();
        Root storage r = _roots[matchweekId];
        if (r.root == bytes32(0) || r.released) revert NoRoot(matchweekId);
        if (block.timestamp < claimOpensAt(matchweekId)) revert ClaimNotOpen(matchweekId);
        if (block.timestamp >= claimClosesAt(matchweekId)) revert ClaimWindowOver(matchweekId);

        bytes32 person = identity.personOf(wallet);
        if (person == bytes32(0)) revert NotVerified(wallet);
        if (personClaimed[matchweekId][person]) revert PersonAlreadyClaimed(matchweekId);

        bytes32 leaf = leafHash(matchweekId, wallet, amount);
        if (leafClaimed[leaf]) revert AlreadyClaimed();
        if (!MerkleProof.verifyCalldata(proof, r.root, leaf)) revert InvalidProof();
        if (r.claimed + amount > r.allocated) revert InsufficientPool();

        leafClaimed[leaf] = true;
        personClaimed[matchweekId][person] = true;
        r.claimed += amount;
        outstanding -= amount;
        token.safeTransfer(wallet, amount);
        emit Claimed(matchweekId, wallet, person, amount);
    }

    /// @notice After the claim window, return a matchweek's unclaimed tokens to the pool. Anyone may call.
    function release(uint32 matchweekId) external {
        Root storage r = _roots[matchweekId];
        if (r.root == bytes32(0) || r.released) revert NoRoot(matchweekId);
        if (block.timestamp < claimClosesAt(matchweekId)) revert ClaimWindowOpen(matchweekId);
        uint128 amount = r.allocated - r.claimed;
        r.released = true;
        outstanding -= amount;
        emit Released(matchweekId, amount);
    }
}
