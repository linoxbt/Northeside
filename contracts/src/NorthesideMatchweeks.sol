// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {INorthesideMatchweeks} from "./interfaces/INorthesideMatchweeks.sol";
import {CommitmentLib} from "./libraries/CommitmentLib.sol";

/// @title NorthesideMatchweeks
/// @notice Season contract for Northeside predictions. Players seal a commitment (a hash of their
///         picks and a random salt) before the first kickoff; after lock the backend publishes every
///         payload, and anyone can check each one against the commitment stored here.
/// @dev Rules enforced on-chain:
///      - commit only while Open and block.timestamp < lockTime; a new commit replaces the old one
///        and bumps the version (the event log keeps every version);
///      - fixturesRoot, lockTime and scoringRulesHash never change after creation;
///      - results can be proposed only after resultsNotBefore (last kickoff plus a buffer);
///      - results, reveals and scores roots are proposed together and are all open to challenge for
///        the whole dispute window; a challenge sends the matchweek back until a fresh proposal;
///        finalize takes no data and is final;
///      - the contract never holds funds.
contract NorthesideMatchweeks is INorthesideMatchweeks, AccessControl, Pausable {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant RESULTS_ROLE = keccak256("RESULTS_ROLE");
    bytes32 public constant CHALLENGER_ROLE = keccak256("CHALLENGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint64 public constant DISPUTE_WINDOW = 12 hours;
    uint32 public constant MAX_FIXTURES = 32;

    struct Commit {
        bytes32 commitment;
        uint32 version;
    }

    mapping(uint32 id => Matchweek) private _matchweeks;
    mapping(uint32 id => mapping(address player => Commit)) private _commits;

    /// @param admin Cold key. Grants and revokes roles; never used by a server.
    /// @param operator Hot key that creates matchweeks.
    /// @param resultsPublisher Hot key (separate from operator) that proposes results and finalizes.
    /// @param pauser Key allowed to pause new commits in an emergency.
    /// @param challengers Keys allowed to challenge proposed results during the dispute window.
    constructor(
        address admin,
        address operator,
        address resultsPublisher,
        address pauser,
        address[] memory challengers
    ) {
        if (admin == address(0) || operator == address(0) || resultsPublisher == address(0)) {
            revert InvalidParams();
        }
        // A dispute window with nobody able to dispute is no safeguard (audit L-2).
        if (challengers.length == 0) revert InvalidParams();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, operator);
        _grantRole(RESULTS_ROLE, resultsPublisher);
        _grantRole(PAUSER_ROLE, admin);
        if (pauser != address(0)) _grantRole(PAUSER_ROLE, pauser);
        for (uint256 i = 0; i < challengers.length; ++i) {
            if (challengers[i] == address(0) || challengers[i] == resultsPublisher) revert InvalidParams();
            _grantRole(CHALLENGER_ROLE, challengers[i]);
        }
    }

    // ---------------------------------------------------------------- operator

    /// @inheritdoc INorthesideMatchweeks
    function createMatchweek(
        uint32 id,
        bytes32 fixturesRoot,
        uint64 lockTime,
        uint64 resultsNotBefore,
        uint32 fixtureCount,
        bytes32 scoringRulesHash
    ) external onlyRole(OPERATOR_ROLE) {
        if (_matchweeks[id].status != Status.None) revert MatchweekExists(id);
        if (
            fixturesRoot == bytes32(0) || scoringRulesHash == bytes32(0) || lockTime <= block.timestamp
                || resultsNotBefore < lockTime || fixtureCount == 0 || fixtureCount > MAX_FIXTURES
        ) revert InvalidParams();

        Matchweek storage mw = _matchweeks[id];
        mw.fixturesRoot = fixturesRoot;
        mw.scoringRulesHash = scoringRulesHash;
        mw.lockTime = lockTime;
        mw.resultsNotBefore = resultsNotBefore;
        mw.fixtureCount = fixtureCount;
        mw.status = Status.Open;

        emit MatchweekCreated(id, fixturesRoot, lockTime, resultsNotBefore, fixtureCount, scoringRulesHash);
    }

    // ---------------------------------------------------------------- players

    /// @inheritdoc INorthesideMatchweeks
    function commit(uint32 id, bytes32 commitment) external whenNotPaused {
        Matchweek storage mw = _matchweeks[id];
        if (mw.status != Status.Open) revert WrongStatus(id, mw.status);
        if (block.timestamp >= mw.lockTime) revert Locked(id);
        if (commitment == bytes32(0)) revert ZeroCommitment();

        Commit storage c = _commits[id][msg.sender];
        if (c.version == 0) {
            unchecked {
                ++mw.playerCount;
            }
        }
        uint32 version = c.version + 1;
        c.commitment = commitment;
        c.version = version;

        emit Committed(id, msg.sender, commitment, version);
    }

    // ---------------------------------------------------------------- results

    /// @inheritdoc INorthesideMatchweeks
    function proposeResults(
        uint32 id,
        bytes32 resultsRoot,
        bytes32 revealsRoot,
        bytes32 scoresRoot,
        string calldata evidenceURI
    ) external onlyRole(RESULTS_ROLE) {
        Matchweek storage mw = _matchweeks[id];
        if (mw.status != Status.Open && mw.status != Status.Challenged) revert WrongStatus(id, mw.status);
        if (block.timestamp < mw.lockTime) revert NotLocked(id);
        if (block.timestamp < mw.resultsNotBefore) revert TooEarly(id);
        if (
            resultsRoot == bytes32(0) || revealsRoot == bytes32(0) || scoresRoot == bytes32(0)
                || bytes(evidenceURI).length == 0
        ) revert InvalidParams();

        uint64 disputeEnds = uint64(block.timestamp) + DISPUTE_WINDOW;
        mw.resultsRoot = resultsRoot;
        mw.revealsRoot = revealsRoot;
        mw.scoresRoot = scoresRoot;
        mw.disputeEnds = disputeEnds;
        mw.status = Status.ResultsProposed;

        emit ResultsProposed(id, resultsRoot, revealsRoot, scoresRoot, evidenceURI, disputeEnds);
    }

    /// @inheritdoc INorthesideMatchweeks
    function challenge(uint32 id, string calldata reasonURI) external onlyRole(CHALLENGER_ROLE) {
        Matchweek storage mw = _matchweeks[id];
        if (mw.status != Status.ResultsProposed) revert WrongStatus(id, mw.status);
        if (block.timestamp >= mw.disputeEnds) revert WindowClosed(id);
        if (bytes(reasonURI).length == 0) revert InvalidParams();

        mw.status = Status.Challenged;

        emit ResultsChallenged(id, msg.sender, reasonURI);
    }

    /// @inheritdoc INorthesideMatchweeks
    /// @dev Takes no data: it can only confirm the roots that sat through the dispute window.
    function finalize(uint32 id) external onlyRole(RESULTS_ROLE) {
        Matchweek storage mw = _matchweeks[id];
        if (mw.status != Status.ResultsProposed) revert WrongStatus(id, mw.status);
        if (block.timestamp < mw.disputeEnds) revert WindowOpen(id);

        mw.status = Status.Finalized;

        emit Finalized(id, mw.resultsRoot, mw.revealsRoot, mw.scoresRoot);
    }

    // ---------------------------------------------------------------- emergency

    /// @notice Stops new commits. Results, challenges and finalization keep working.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Admin only, so a leaked pauser key cannot undo an emergency pause.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc INorthesideMatchweeks
    function matchweek(uint32 id) external view returns (Matchweek memory) {
        return _matchweeks[id];
    }

    /// @inheritdoc INorthesideMatchweeks
    function commitmentOf(uint32 id, address player)
        external
        view
        returns (bytes32 commitment, uint32 version)
    {
        Commit storage c = _commits[id][player];
        return (c.commitment, c.version);
    }

    /// @inheritdoc INorthesideMatchweeks
    function isLocked(uint32 id) external view returns (bool) {
        Matchweek storage mw = _matchweeks[id];
        return mw.status != Status.None && block.timestamp >= mw.lockTime;
    }

    /// @inheritdoc INorthesideMatchweeks
    function isFinalized(uint32 id) external view returns (bool) {
        return _matchweeks[id].status == Status.Finalized;
    }

    /// @inheritdoc INorthesideMatchweeks
    function computeCommitment(address player, uint32 id, bytes32 predictionsHash, bytes32 salt)
        public
        view
        returns (bytes32)
    {
        Matchweek storage mw = _matchweeks[id];
        if (mw.status == Status.None) revert UnknownMatchweek(id);
        return CommitmentLib.commitment(
            block.chainid, address(this), player, id, mw.fixturesRoot, predictionsHash, salt
        );
    }

    /// @inheritdoc INorthesideMatchweeks
    function verifyReveal(address player, uint32 id, bytes32 predictionsHash, bytes32 salt)
        external
        view
        returns (bool)
    {
        bytes32 stored = _commits[id][player].commitment;
        return stored != bytes32(0) && stored == computeCommitment(player, id, predictionsHash, salt);
    }
}
