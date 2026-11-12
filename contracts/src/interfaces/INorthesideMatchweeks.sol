// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title INorthesideMatchweeks
/// @notice One contract for the whole season. A matchweek moves
///         Open -> (locked by time) -> ResultsProposed -> Finalized, with Challenged as a detour
///         back to ResultsProposed. Results, reveals and scores are proposed together, so all three
///         are open to challenge for the whole window. The contract holds no funds.
interface INorthesideMatchweeks {
    enum Status {
        None,
        Open,
        ResultsProposed,
        Challenged,
        Finalized
    }

    struct Matchweek {
        bytes32 fixturesRoot; // Merkle root of canonical fixtures
        bytes32 scoringRulesHash; // keccak256 of the published scoring rules
        uint64 lockTime; // earliest kickoff, unix seconds
        uint64 resultsNotBefore; // last kickoff plus a buffer; no results before this
        uint64 disputeEnds; // set when results are proposed
        uint32 fixtureCount;
        uint32 playerCount; // distinct addresses that committed (not verified persons)
        bytes32 resultsRoot;
        bytes32 revealsRoot; // Merkle root of every revealed payload
        bytes32 scoresRoot; // Merkle root of every player's points
        Status status;
    }

    event MatchweekCreated(
        uint32 indexed id,
        bytes32 fixturesRoot,
        uint64 lockTime,
        uint64 resultsNotBefore,
        uint32 fixtureCount,
        bytes32 scoringRulesHash
    );
    event Committed(uint32 indexed id, address indexed player, bytes32 commitment, uint32 version);
    event ResultsProposed(
        uint32 indexed id,
        bytes32 resultsRoot,
        bytes32 revealsRoot,
        bytes32 scoresRoot,
        string evidenceURI,
        uint64 disputeEnds
    );
    event ResultsChallenged(uint32 indexed id, address indexed challenger, string reasonURI);
    event Finalized(uint32 indexed id, bytes32 resultsRoot, bytes32 revealsRoot, bytes32 scoresRoot);

    error MatchweekExists(uint32 id);
    error UnknownMatchweek(uint32 id);
    error InvalidParams();
    error ZeroCommitment();
    error Locked(uint32 id);
    error NotLocked(uint32 id);
    error TooEarly(uint32 id);
    error WrongStatus(uint32 id, Status status);
    error WindowOpen(uint32 id);
    error WindowClosed(uint32 id);

    function createMatchweek(
        uint32 id,
        bytes32 fixturesRoot,
        uint64 lockTime,
        uint64 resultsNotBefore,
        uint32 fixtureCount,
        bytes32 scoringRulesHash
    ) external;
    function commit(uint32 id, bytes32 commitment) external;
    function proposeResults(
        uint32 id,
        bytes32 resultsRoot,
        bytes32 revealsRoot,
        bytes32 scoresRoot,
        string calldata evidenceURI
    ) external;
    function challenge(uint32 id, string calldata reasonURI) external;
    function finalize(uint32 id) external;

    function matchweek(uint32 id) external view returns (Matchweek memory);
    function commitmentOf(uint32 id, address player)
        external
        view
        returns (bytes32 commitment, uint32 version);
    function isLocked(uint32 id) external view returns (bool);
    function isFinalized(uint32 id) external view returns (bool);
    function computeCommitment(address player, uint32 id, bytes32 predictionsHash, bytes32 salt)
        external
        view
        returns (bytes32);
    function verifyReveal(address player, uint32 id, bytes32 predictionsHash, bytes32 salt)
        external
        view
        returns (bool);
}
