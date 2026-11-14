// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {INorthesideMatchweeks} from "./interfaces/INorthesideMatchweeks.sol";

/// @title HostRewards
/// @notice Sponsors fund campaigns in QUSDC. After each finalized matchweek the operator posts one
///         Merkle root of host payouts (computed off-chain from verified, returning players), and
///         after a 24-hour review delay hosts claim with a proof.
/// @dev Money only leaves this contract three ways: a platform fee to the treasury at funding time,
///      a host claim with a valid proof against a posted root, or a refund to the campaign's refund
///      recipient. Trust model, stated plainly: the OPERATOR role decides who is in a root, so a
///      compromised operator key could post a root paying itself up to the remaining budget of each
///      active campaign. Mitigations: the CLAIM_DELAY review window (during which the admin can
///      voidRoot, or the operator replaceRoot, any bad root, even after expiry), only the admin can
///      unpause (a leaked pauser or operator key cannot undo an emergency pause), the admin can
///      revoke roles, and launch caps bound exposure.
///
///      Accounting per campaign:  budget = gross - fee;  claimed <= allocated <= budget.
///      Over all campaigns: token.balanceOf(this) >= sum(budget - claimed - refunded); equality
///      unless someone sends tokens here directly (those are not recoverable).
contract HostRewards is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Hard ceiling on the platform fee: 10%.
    uint16 public constant MAX_FEE_BPS = 1_000;
    uint16 private constant BPS = 10_000;
    /// @notice After a campaign expires, hosts have this long to claim before the sponsor can sweep.
    ///         Time spent paused after funding is added on top (see claimDeadline).
    uint64 public constant CLAIM_PERIOD = 30 days;
    /// @notice A posted root can be claimed against only after this review delay.
    uint64 public constant CLAIM_DELAY = 24 hours;

    enum CampaignStatus {
        None,
        Pending, // terms agreed, not funded
        Active, // funded; roots until expiry, claims until claimDeadline
        Closed, // swept back to the sponsor after the claim period
        Cancelled // never funded
    }

    /// @notice Terms agreed off-chain with the sponsor; fixed once the campaign is created.
    struct Terms {
        address sponsor;
        uint128 grossAmount; // what the sponsor pays in, fee included (token base units)
        uint16 feeBps; // platform fee taken from grossAmount at funding
        uint128 ratePerPlayer; // per countable player, per matchweek (informational; enforced off-chain)
        uint128 capPerHost; // per host, per matchweek (informational; enforced off-chain)
        uint32 firstMatchweek;
        uint32 lastMatchweek;
        uint64 expiry; // no roots after this; refunds of unallocated budget open
        bytes32 leaguesHash; // hash of the eligible league list
        bytes32 termsHash; // hash of the signed sponsor terms document
    }

    struct Campaign {
        Terms terms;
        CampaignStatus status;
        uint128 budget;
        uint128 allocated;
        uint128 claimed;
        uint128 refunded;
        /// @dev pausedTotal at funding time; only pauses after funding extend this campaign's deadline.
        uint64 pauseBase;
    }

    IERC20 public immutable token;
    INorthesideMatchweeks public immutable matchweeks;

    address public treasury;
    /// @notice Launch caps until an independent review: 500 QUSDC per campaign, 2,000 in total.
    uint128 public maxCampaignBudget;
    uint128 public maxTotalLiability;
    /// @notice Sum over campaigns of (budget - claimed - refunded): what the contract owes.
    uint128 public totalLiability;
    uint256 public campaignCount;

    /// @notice Total seconds spent paused (closed pauses), and the start of the current pause.
    uint64 public pausedTotal;
    uint64 public pausedAt;

    mapping(uint256 campaignId => Campaign) private _campaigns;
    mapping(uint256 campaignId => address) public refundRecipientOf;
    mapping(uint256 campaignId => mapping(uint32 matchweekId => bytes32)) public rootOf;
    mapping(uint256 campaignId => mapping(uint32 matchweekId => uint64)) public rootPostedAt;
    mapping(uint256 campaignId => mapping(uint32 matchweekId => uint128)) public allocatedFor;
    mapping(uint256 campaignId => mapping(uint32 matchweekId => uint128)) public claimedFor;
    mapping(bytes32 leaf => bool) public leafClaimed;

    event CampaignCreated(uint256 indexed id, address indexed sponsor, Terms terms, uint128 budget);
    event CampaignCancelled(uint256 indexed id);
    event CampaignFunded(
        uint256 indexed id, address indexed sponsor, uint128 gross, uint128 fee, uint128 budget
    );
    event RootPosted(
        uint256 indexed id, uint32 indexed matchweekId, bytes32 root, uint128 total, string reportURI
    );
    event RootReplaced(
        uint256 indexed id,
        uint32 indexed matchweekId,
        bytes32 oldRoot,
        bytes32 root,
        uint128 total,
        string reportURI
    );
    event RootVoided(
        uint256 indexed id, uint32 indexed matchweekId, bytes32 oldRoot, uint128 releasedAllocation
    );
    event Claimed(
        uint256 indexed id,
        uint32 indexed matchweekId,
        address indexed host,
        uint128 amount,
        uint32 countablePlayers
    );
    event Refunded(uint256 indexed id, address indexed recipient, uint128 amount, bool closed);
    event RefundRecipientSet(uint256 indexed id, address indexed recipient);
    event TreasuryUpdated(address indexed treasury);
    event CapsUpdated(uint128 maxCampaignBudget, uint128 maxTotalLiability);

    error InvalidParams();
    error WrongStatus(uint256 id, CampaignStatus status);
    error NotSponsor();
    error Expired(uint256 id);
    error NotExpired(uint256 id);
    error ClaimPeriodOver(uint256 id);
    error CapExceeded();
    error MatchweekOutOfRange(uint32 matchweekId);
    error MatchweekNotFinalized(uint32 matchweekId);
    error RootExists(uint256 id, uint32 matchweekId);
    error NoRoot(uint256 id, uint32 matchweekId);
    error AlreadyClaimedFrom(uint256 id, uint32 matchweekId);
    error ClaimNotOpen(uint256 id, uint32 matchweekId);
    error OverBudget();
    error AlreadyClaimed();
    error InvalidProof();
    error UnsupportedToken();
    error NothingToRefund();

    constructor(
        address admin,
        address operator,
        address pauser,
        IERC20 token_,
        INorthesideMatchweeks matchweeks_,
        address treasury_,
        uint128 maxCampaignBudget_,
        uint128 maxTotalLiability_
    ) {
        if (
            admin == address(0) || operator == address(0) || address(token_) == address(0)
                || address(matchweeks_) == address(0) || treasury_ == address(0) || maxCampaignBudget_ == 0
                || maxTotalLiability_ < maxCampaignBudget_
        ) revert InvalidParams();
        token = token_;
        matchweeks = matchweeks_;
        treasury = treasury_;
        maxCampaignBudget = maxCampaignBudget_;
        maxTotalLiability = maxTotalLiability_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, operator);
        _grantRole(PAUSER_ROLE, admin);
        if (pauser != address(0)) _grantRole(PAUSER_ROLE, pauser);
    }

    // ---------------------------------------------------------------- campaign lifecycle

    /// @notice Record terms agreed with a sponsor. Nothing moves until the sponsor calls fund().
    function createCampaign(Terms calldata t) external onlyRole(OPERATOR_ROLE) returns (uint256 id) {
        if (
            t.sponsor == address(0) || t.grossAmount == 0 || t.feeBps > MAX_FEE_BPS || t.ratePerPlayer == 0
                || t.capPerHost == 0 || t.firstMatchweek > t.lastMatchweek || t.expiry <= block.timestamp
                || t.termsHash == bytes32(0)
        ) revert InvalidParams();

        uint128 budget = _budgetOf(t.grossAmount, t.feeBps);
        if (budget == 0) revert InvalidParams();
        if (budget > maxCampaignBudget) revert CapExceeded();

        id = ++campaignCount;
        Campaign storage c = _campaigns[id];
        c.terms = t;
        c.status = CampaignStatus.Pending;
        c.budget = budget;

        emit CampaignCreated(id, t.sponsor, t, budget);
    }

    function cancelCampaign(uint256 id) external onlyRole(OPERATOR_ROLE) {
        Campaign storage c = _campaigns[id];
        if (c.status != CampaignStatus.Pending) revert WrongStatus(id, c.status);
        c.status = CampaignStatus.Cancelled;
        emit CampaignCancelled(id);
    }

    /// @notice The sponsor pays grossAmount (after approving it); the fee goes to the treasury and
    ///         the rest is escrowed as the campaign budget. Terms are locked from here on.
    function fund(uint256 id) external nonReentrant whenNotPaused {
        Campaign storage c = _campaigns[id];
        if (c.status != CampaignStatus.Pending) revert WrongStatus(id, c.status);
        if (msg.sender != c.terms.sponsor) revert NotSponsor();
        if (block.timestamp >= c.terms.expiry) revert Expired(id);

        uint128 budget = c.budget;
        if (budget > maxCampaignBudget) revert CapExceeded();
        if (uint256(totalLiability) + budget > maxTotalLiability) revert CapExceeded();

        uint128 gross = c.terms.grossAmount;
        uint128 fee = gross - budget;

        c.status = CampaignStatus.Active;
        c.pauseBase = pausedTotal;
        totalLiability += budget;

        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), gross);
        if (token.balanceOf(address(this)) - before != gross) revert UnsupportedToken();
        if (fee > 0) token.safeTransfer(treasury, fee);

        emit CampaignFunded(id, msg.sender, gross, fee, budget);
    }

    /// @notice Where refunds go. Defaults to the sponsor; the sponsor can point it elsewhere, e.g. if
    ///         its own address can no longer receive the token.
    function setRefundRecipient(uint256 id, address recipient) external {
        Campaign storage c = _campaigns[id];
        if (msg.sender != c.terms.sponsor) revert NotSponsor();
        if (recipient == address(0)) revert InvalidParams();
        refundRecipientOf[id] = recipient;
        emit RefundRecipientSet(id, recipient);
    }

    /// @notice Post the Merkle root of host payouts for one finalized matchweek.
    /// @param total Sum of every leaf amount in the tree; claims for this matchweek cannot exceed it.
    function postRoot(uint256 id, uint32 matchweekId, bytes32 root, uint128 total, string calldata reportURI)
        external
        onlyRole(OPERATOR_ROLE)
    {
        Campaign storage c = _campaigns[id];
        _checkRootTarget(id, c, matchweekId);
        if (rootOf[id][matchweekId] != bytes32(0)) revert RootExists(id, matchweekId);
        if (root == bytes32(0) || total == 0 || bytes(reportURI).length == 0) revert InvalidParams();
        if (uint256(c.allocated) + total > c.budget) revert OverBudget();

        rootOf[id][matchweekId] = root;
        rootPostedAt[id][matchweekId] = uint64(block.timestamp);
        allocatedFor[id][matchweekId] = total;
        c.allocated += total;

        emit RootPosted(id, matchweekId, root, total, reportURI);
    }

    /// @notice Correct a posted root while nothing has been claimed against it. Restarts the review
    ///         delay. The old root's leaves can no longer be claimed.
    function replaceRoot(
        uint256 id,
        uint32 matchweekId,
        bytes32 root,
        uint128 total,
        string calldata reportURI
    ) external onlyRole(OPERATOR_ROLE) {
        Campaign storage c = _campaigns[id];
        // Unlike postRoot this also works after expiry, until the claim deadline: a root posted just
        // before expiry must still be correctable during its review delay.
        _checkCorrectable(id, c, matchweekId);
        if (root == bytes32(0) || total == 0 || bytes(reportURI).length == 0) revert InvalidParams();
        bytes32 oldRoot = rootOf[id][matchweekId];
        if (root == oldRoot) revert InvalidParams();
        uint256 allocated = uint256(c.allocated) - allocatedFor[id][matchweekId] + total;
        if (allocated > c.budget) revert OverBudget();

        rootOf[id][matchweekId] = root;
        rootPostedAt[id][matchweekId] = uint64(block.timestamp);
        allocatedFor[id][matchweekId] = total;
        c.allocated = uint128(allocated);

        emit RootReplaced(id, matchweekId, oldRoot, root, total, reportURI);
    }

    /// @notice Admin backstop for a bad root nobody has claimed from yet: removes it and releases its
    ///         allocation (refundable to the sponsor; before expiry the operator may post a new one).
    ///         Works after expiry until the claim deadline, while paused or not.
    function voidRoot(uint256 id, uint32 matchweekId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Campaign storage c = _campaigns[id];
        _checkCorrectable(id, c, matchweekId);
        bytes32 oldRoot = rootOf[id][matchweekId];
        uint128 released = allocatedFor[id][matchweekId];
        delete rootOf[id][matchweekId];
        delete rootPostedAt[id][matchweekId];
        delete allocatedFor[id][matchweekId];
        c.allocated -= released;
        emit RootVoided(id, matchweekId, oldRoot, released);
    }

    /// @notice Pay a host their share for one matchweek. Anyone may submit; funds always go to `host`.
    function claim(
        uint256 id,
        uint32 matchweekId,
        address host,
        uint128 amount,
        uint32 countablePlayers,
        bytes32[] calldata proof
    ) external nonReentrant whenNotPaused {
        Campaign storage c = _campaigns[id];
        if (c.status != CampaignStatus.Active) revert WrongStatus(id, c.status);
        if (block.timestamp >= claimDeadline(id)) revert ClaimPeriodOver(id);
        if (host == address(0) || amount == 0) revert InvalidParams();

        bytes32 root = rootOf[id][matchweekId];
        if (root == bytes32(0)) revert NoRoot(id, matchweekId);
        if (block.timestamp < uint256(rootPostedAt[id][matchweekId]) + CLAIM_DELAY) {
            revert ClaimNotOpen(id, matchweekId);
        }

        bytes32 leaf = leafHash(id, matchweekId, host, amount, countablePlayers);
        if (leafClaimed[leaf]) revert AlreadyClaimed();
        if (!MerkleProof.verifyCalldata(proof, root, leaf)) revert InvalidProof();

        uint128 claimedForMw = claimedFor[id][matchweekId] + amount;
        if (claimedForMw > allocatedFor[id][matchweekId]) revert OverBudget();

        leafClaimed[leaf] = true;
        claimedFor[id][matchweekId] = claimedForMw;
        c.claimed += amount;
        totalLiability -= amount;

        token.safeTransfer(host, amount);

        emit Claimed(id, matchweekId, host, amount, countablePlayers);
    }

    /// @notice Return money to the sponsor's refund recipient. Anyone may trigger it.
    ///         From expiry: the unallocated budget. From claimDeadline: everything left, and the
    ///         campaign closes.
    /// @dev Not pausable: the unallocated budget can always be refunded from expiry. While paused,
    ///      claimDeadline moves with time, so the final sweep of allocated-but-unclaimed money waits
    ///      until the admin unpauses; in exchange a pause can never make hosts lose their allocation.
    function refund(uint256 id) external nonReentrant returns (uint128 amount) {
        Campaign storage c = _campaigns[id];
        if (c.status != CampaignStatus.Active) revert WrongStatus(id, c.status);
        if (block.timestamp < c.terms.expiry) revert NotExpired(id);

        bool closing = block.timestamp >= claimDeadline(id);
        if (closing) {
            amount = c.budget - c.claimed - c.refunded;
            c.status = CampaignStatus.Closed;
        } else {
            // Allocated money stays reserved for hosts until the claim period ends.
            amount = c.budget - c.allocated - c.refunded;
        }
        if (amount == 0 && !closing) revert NothingToRefund();

        c.refunded += amount;
        totalLiability -= amount;

        address recipient = refundRecipientOf[id];
        if (recipient == address(0)) recipient = c.terms.sponsor;
        if (amount > 0) token.safeTransfer(recipient, amount);

        emit Refunded(id, recipient, amount, closing);
    }

    // ---------------------------------------------------------------- admin

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasury_ == address(0)) revert InvalidParams();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    /// @notice Raise or lower the launch caps (e.g. after an independent review).
    function setCaps(uint128 maxCampaignBudget_, uint128 maxTotalLiability_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (maxCampaignBudget_ == 0 || maxTotalLiability_ < maxCampaignBudget_) {
            revert InvalidParams();
        }
        maxCampaignBudget = maxCampaignBudget_;
        maxTotalLiability = maxTotalLiability_;
        emit CapsUpdated(maxCampaignBudget_, maxTotalLiability_);
    }

    /// @notice Stops funding and claims. Refunds keep working; claim deadlines extend by the pause.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
        pausedAt = uint64(block.timestamp);
    }

    /// @notice Admin only, so a leaked pauser or operator key cannot undo an emergency pause.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
        pausedTotal += uint64(block.timestamp) - pausedAt;
        pausedAt = 0;
    }

    // ---------------------------------------------------------------- views

    function campaign(uint256 id) external view returns (Campaign memory) {
        return _campaigns[id];
    }

    /// @notice Last moment (exclusive) hosts can claim: expiry + CLAIM_PERIOD, plus any time the
    ///         contract has spent paused since this campaign was funded (including a pause in progress).
    function claimDeadline(uint256 id) public view returns (uint256) {
        Campaign storage c = _campaigns[id];
        uint256 paused_ = uint256(pausedTotal) - c.pauseBase;
        if (paused()) paused_ += block.timestamp - pausedAt;
        return uint256(c.terms.expiry) + CLAIM_PERIOD + paused_;
    }

    /// @notice Leaf of the host-rewards tree, matching OpenZeppelin StandardMerkleTree
    ///         (double-hashed) over (uint256, uint32, address, uint128, uint32).
    function leafHash(uint256 id, uint32 matchweekId, address host, uint128 amount, uint32 countablePlayers)
        public
        pure
        returns (bytes32)
    {
        return keccak256(bytes.concat(keccak256(abi.encode(id, matchweekId, host, amount, countablePlayers))));
    }

    function budgetOf(uint128 grossAmount, uint16 feeBps) external pure returns (uint128) {
        return _budgetOf(grossAmount, feeBps);
    }

    function _budgetOf(uint128 grossAmount, uint16 feeBps) private pure returns (uint128) {
        uint128 fee = uint128((uint256(grossAmount) * feeBps) / BPS);
        return grossAmount - fee;
    }

    /// @dev A posted root that nobody has claimed from, in a live campaign, before the claim deadline.
    function _checkCorrectable(uint256 id, Campaign storage c, uint32 matchweekId) private view {
        if (c.status != CampaignStatus.Active) revert WrongStatus(id, c.status);
        if (block.timestamp >= claimDeadline(id)) revert ClaimPeriodOver(id);
        if (rootOf[id][matchweekId] == bytes32(0)) revert NoRoot(id, matchweekId);
        if (claimedFor[id][matchweekId] != 0) revert AlreadyClaimedFrom(id, matchweekId);
    }

    function _checkRootTarget(uint256 id, Campaign storage c, uint32 matchweekId) private view {
        if (c.status != CampaignStatus.Active) revert WrongStatus(id, c.status);
        if (block.timestamp >= c.terms.expiry) revert Expired(id);
        if (matchweekId < c.terms.firstMatchweek || matchweekId > c.terms.lastMatchweek) {
            revert MatchweekOutOfRange(matchweekId);
        }
        if (!matchweeks.isFinalized(matchweekId)) revert MatchweekNotFinalized(matchweekId);
    }
}
