// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {vm} from "./utils/Vm.sol";
import {Base} from "./utils/Base.sol";
import {NorthesideMatchweeks} from "../src/NorthesideMatchweeks.sol";
import {INorthesideMatchweeks} from "../src/interfaces/INorthesideMatchweeks.sol";
import {CommitmentLib} from "../src/libraries/CommitmentLib.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract NorthesideMatchweeksTest is Base {
    NorthesideMatchweeks internal mw;

    address internal admin = makeAddr("admin");
    address internal operator = makeAddr("operator");
    address internal results = makeAddr("results");
    address internal pauser = makeAddr("pauser");
    address internal challenger = makeAddr("challenger");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint32 internal constant ID = 11;
    bytes32 internal constant FIXTURES = keccak256("fixtures");
    bytes32 internal constant RULES = keccak256("scoring-rules-v1");
    uint64 internal lockTime;

    function setUp() public {
        vm.warp(1_763_000_000); // Nov 2025-ish; any fixed start works
        address[] memory challengers = new address[](1);
        challengers[0] = challenger;
        mw = new NorthesideMatchweeks(admin, operator, results, pauser, challengers);
        lockTime = uint64(block.timestamp + 3 days);
        vm.prank(operator);
        mw.createMatchweek(ID, FIXTURES, lockTime, 10, RULES);
    }

    // ------------------------------------------------------------ construction and roles

    function test_constructor_grantsRoles() public view {
        assertTrue(mw.hasRole(mw.DEFAULT_ADMIN_ROLE(), admin), "admin");
        assertTrue(mw.hasRole(mw.OPERATOR_ROLE(), operator), "operator");
        assertTrue(mw.hasRole(mw.RESULTS_ROLE(), results), "results");
        assertTrue(mw.hasRole(mw.PAUSER_ROLE(), pauser), "pauser");
        assertTrue(mw.hasRole(mw.PAUSER_ROLE(), admin), "admin pauses");
        assertTrue(mw.hasRole(mw.CHALLENGER_ROLE(), challenger), "challenger");
        assertFalse(mw.hasRole(mw.OPERATOR_ROLE(), results), "roles separated");
    }

    function test_constructor_rejectsZeroKeys() public {
        address[] memory none = new address[](0);
        vm.expectRevert(INorthesideMatchweeks.InvalidParams.selector);
        new NorthesideMatchweeks(address(0), operator, results, pauser, none);
        vm.expectRevert(INorthesideMatchweeks.InvalidParams.selector);
        new NorthesideMatchweeks(admin, address(0), results, pauser, none);
        vm.expectRevert(INorthesideMatchweeks.InvalidParams.selector);
        new NorthesideMatchweeks(admin, operator, address(0), pauser, none);
    }

    // ------------------------------------------------------------ createMatchweek

    function test_create_storesImmutableFields() public view {
        INorthesideMatchweeks.Matchweek memory m = mw.matchweek(ID);
        assertEq(m.fixturesRoot, FIXTURES, "fixtures");
        assertEq(m.scoringRulesHash, RULES, "rules");
        assertEq(m.lockTime, lockTime, "lock");
        assertEq(m.fixtureCount, 10, "count");
        assertEq(uint256(m.status), uint256(INorthesideMatchweeks.Status.Open), "status");
    }

    function test_create_emits() public {
        vm.expectEmit(true, false, false, true, address(mw));
        emit INorthesideMatchweeks.MatchweekCreated(12, FIXTURES, lockTime + 7 days, 10, RULES);
        vm.prank(operator);
        mw.createMatchweek(12, FIXTURES, lockTime + 7 days, 10, RULES);
    }

    function test_create_onlyOperator() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, mw.OPERATOR_ROLE()
            )
        );
        vm.prank(alice);
        mw.createMatchweek(12, FIXTURES, lockTime, 10, RULES);
    }

    function test_create_rejectsDuplicateId() public {
        vm.expectRevert(abi.encodeWithSelector(INorthesideMatchweeks.MatchweekExists.selector, ID));
        vm.prank(operator);
        mw.createMatchweek(ID, keccak256("other"), lockTime + 1, 10, RULES);
    }

    function test_create_rejectsInvalidParams() public {
        vm.startPrank(operator);
        vm.expectRevert(INorthesideMatchweeks.InvalidParams.selector);
        mw.createMatchweek(20, bytes32(0), lockTime, 10, RULES);
        vm.expectRevert(INorthesideMatchweeks.InvalidParams.selector);
        mw.createMatchweek(20, FIXTURES, lockTime, 10, bytes32(0));
        vm.expectRevert(INorthesideMatchweeks.InvalidParams.selector);
        mw.createMatchweek(20, FIXTURES, uint64(block.timestamp), 10, RULES);
        vm.expectRevert(INorthesideMatchweeks.InvalidParams.selector);
        mw.createMatchweek(20, FIXTURES, lockTime, 0, RULES);
        vm.expectRevert(INorthesideMatchweeks.InvalidParams.selector);
        mw.createMatchweek(20, FIXTURES, lockTime, 33, RULES);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ commit

    function test_commit_storesAndCountsPlayers() public {
        vm.expectEmit(true, true, false, true, address(mw));
        emit INorthesideMatchweeks.Committed(ID, alice, keccak256("a1"), 1);
        vm.prank(alice);
        mw.commit(ID, keccak256("a1"));

        (bytes32 c, uint32 v) = mw.commitmentOf(ID, alice);
        assertEq(c, keccak256("a1"), "commitment");
        assertEq(v, 1, "version");
        assertEq(mw.matchweek(ID).playerCount, 1, "players");
    }

    function test_commit_resealReplacesAndBumpsVersion() public {
        vm.startPrank(alice);
        mw.commit(ID, keccak256("a1"));
        mw.commit(ID, keccak256("a2"));
        vm.stopPrank();
        vm.prank(bob);
        mw.commit(ID, keccak256("b1"));

        (bytes32 c, uint32 v) = mw.commitmentOf(ID, alice);
        assertEq(c, keccak256("a2"), "latest wins");
        assertEq(v, 2, "version");
        assertEq(mw.matchweek(ID).playerCount, 2, "re-seal does not double count");
    }

    function test_commit_revertsAtAndAfterLock() public {
        vm.warp(lockTime);
        vm.expectRevert(abi.encodeWithSelector(INorthesideMatchweeks.Locked.selector, ID));
        vm.prank(alice);
        mw.commit(ID, keccak256("late"));
        assertTrue(mw.isLocked(ID), "locked");
    }

    function test_commit_revertsOnUnknownMatchweek() public {
        vm.expectRevert(
            abi.encodeWithSelector(INorthesideMatchweeks.WrongStatus.selector, 99, INorthesideMatchweeks.Status.None)
        );
        vm.prank(alice);
        mw.commit(99, keccak256("x"));
    }

    function test_commit_rejectsZero() public {
        vm.expectRevert(INorthesideMatchweeks.ZeroCommitment.selector);
        vm.prank(alice);
        mw.commit(ID, bytes32(0));
    }

    function test_commit_pausedThenUnpaused() public {
        vm.prank(pauser);
        mw.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(alice);
        mw.commit(ID, keccak256("a"));

        vm.prank(pauser);
        mw.unpause();
        vm.prank(alice);
        mw.commit(ID, keccak256("a"));
    }

    function test_pause_onlyPauser() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, mw.PAUSER_ROLE())
        );
        vm.prank(alice);
        mw.pause();
    }

    /// @dev Spec 12.2: commit before and after lockTime at random timestamps.
    function testFuzz_commit_respectsLock(uint256 t) public {
        t = bound(t, block.timestamp, uint256(lockTime) + 30 days);
        vm.warp(t);
        if (t < lockTime) {
            vm.prank(alice);
            mw.commit(ID, keccak256(abi.encode(t)));
            (bytes32 c,) = mw.commitmentOf(ID, alice);
            assertEq(c, keccak256(abi.encode(t)), "stored");
        } else {
            vm.expectRevert(abi.encodeWithSelector(INorthesideMatchweeks.Locked.selector, ID));
            vm.prank(alice);
            mw.commit(ID, keccak256(abi.encode(t)));
        }
    }

    // ------------------------------------------------------------ results lifecycle

    function test_propose_beforeLockReverts() public {
        vm.expectRevert(abi.encodeWithSelector(INorthesideMatchweeks.NotLocked.selector, ID));
        vm.prank(results);
        mw.proposeResults(ID, keccak256("r"), "ipfs://evidence");
    }

    function test_propose_onlyResultsRole() public {
        vm.warp(lockTime);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, operator, mw.RESULTS_ROLE())
        );
        vm.prank(operator);
        mw.proposeResults(ID, keccak256("r"), "ipfs://evidence");
    }

    function test_propose_requiresRootAndEvidence() public {
        vm.warp(lockTime);
        vm.startPrank(results);
        vm.expectRevert(INorthesideMatchweeks.InvalidParams.selector);
        mw.proposeResults(ID, bytes32(0), "ipfs://evidence");
        vm.expectRevert(INorthesideMatchweeks.InvalidParams.selector);
        mw.proposeResults(ID, keccak256("r"), "");
        vm.stopPrank();
    }

    function test_lifecycle_fullPathWithChallenge() public {
        vm.prank(alice);
        mw.commit(ID, keccak256("a"));

        // lock -> propose
        vm.warp(lockTime + 2 days);
        vm.prank(results);
        mw.proposeResults(ID, keccak256("wrong"), "ipfs://v1");
        INorthesideMatchweeks.Matchweek memory m = mw.matchweek(ID);
        assertEq(uint256(m.status), uint256(INorthesideMatchweeks.Status.ResultsProposed), "proposed");
        assertEq(m.disputeEnds, block.timestamp + 12 hours, "window");

        // finalize inside the window reverts
        vm.expectRevert(abi.encodeWithSelector(INorthesideMatchweeks.WindowOpen.selector, ID));
        vm.prank(results);
        mw.finalize(ID, keccak256("rev"), keccak256("scores"));

        // challenge -> Challenged; finalize now reverts on status
        vm.prank(challenger);
        mw.challenge(ID, "ipfs://why");
        assertEq(uint256(mw.matchweek(ID).status), uint256(INorthesideMatchweeks.Status.Challenged), "challenged");
        vm.warp(block.timestamp + 13 hours);
        vm.expectRevert(
            abi.encodeWithSelector(
                INorthesideMatchweeks.WrongStatus.selector, ID, INorthesideMatchweeks.Status.Challenged
            )
        );
        vm.prank(results);
        mw.finalize(ID, keccak256("rev"), keccak256("scores"));

        // re-propose opens a fresh window
        vm.prank(results);
        mw.proposeResults(ID, keccak256("right"), "ipfs://v2");
        assertEq(mw.matchweek(ID).disputeEnds, block.timestamp + 12 hours, "fresh window");

        vm.warp(block.timestamp + 12 hours);
        vm.expectEmit(true, false, false, true, address(mw));
        emit INorthesideMatchweeks.Finalized(ID, keccak256("right"), keccak256("rev"), keccak256("scores"));
        vm.prank(results);
        mw.finalize(ID, keccak256("rev"), keccak256("scores"));

        m = mw.matchweek(ID);
        assertTrue(mw.isFinalized(ID), "final");
        assertEq(m.resultsRoot, keccak256("right"), "results root");
        assertEq(m.revealsRoot, keccak256("rev"), "reveals root");
        assertEq(m.scoresRoot, keccak256("scores"), "scores root");
    }

    function test_finalized_isImmutable() public {
        _finalize();
        vm.startPrank(results);
        vm.expectRevert(
            abi.encodeWithSelector(
                INorthesideMatchweeks.WrongStatus.selector, ID, INorthesideMatchweeks.Status.Finalized
            )
        );
        mw.proposeResults(ID, keccak256("x"), "ipfs://x");
        vm.expectRevert(
            abi.encodeWithSelector(
                INorthesideMatchweeks.WrongStatus.selector, ID, INorthesideMatchweeks.Status.Finalized
            )
        );
        mw.finalize(ID, keccak256("x"), keccak256("y"));
        vm.stopPrank();

        vm.expectRevert(
            abi.encodeWithSelector(
                INorthesideMatchweeks.WrongStatus.selector, ID, INorthesideMatchweeks.Status.Finalized
            )
        );
        vm.prank(challenger);
        mw.challenge(ID, "ipfs://late");

        vm.expectRevert(
            abi.encodeWithSelector(
                INorthesideMatchweeks.WrongStatus.selector, ID, INorthesideMatchweeks.Status.Finalized
            )
        );
        vm.prank(alice);
        mw.commit(ID, keccak256("late"));
    }

    function test_challenge_afterWindowReverts() public {
        vm.warp(lockTime);
        vm.prank(results);
        mw.proposeResults(ID, keccak256("r"), "ipfs://e");
        vm.warp(block.timestamp + 12 hours);
        vm.expectRevert(abi.encodeWithSelector(INorthesideMatchweeks.WindowClosed.selector, ID));
        vm.prank(challenger);
        mw.challenge(ID, "ipfs://late");
    }

    function test_challenge_onlyChallenger() public {
        vm.warp(lockTime);
        vm.prank(results);
        mw.proposeResults(ID, keccak256("r"), "ipfs://e");
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, mw.CHALLENGER_ROLE()
            )
        );
        vm.prank(alice);
        mw.challenge(ID, "ipfs://x");
    }

    function test_finalize_requiresRoots() public {
        vm.warp(lockTime);
        vm.prank(results);
        mw.proposeResults(ID, keccak256("r"), "ipfs://e");
        vm.warp(block.timestamp + 12 hours);
        vm.expectRevert(INorthesideMatchweeks.InvalidParams.selector);
        vm.prank(results);
        mw.finalize(ID, bytes32(0), keccak256("s"));
    }

    function test_pause_doesNotBlockResults() public {
        vm.prank(pauser);
        mw.pause();
        _finalize();
        assertTrue(mw.isFinalized(ID), "results flow while paused");
    }

    // ------------------------------------------------------------ commitments

    /// @dev Spec 12.2: random predictions and salts recompute to the same commitment on-chain and
    ///      off-chain. Off-chain parity is checked against golden vectors (CommitmentTest + Vitest).
    function testFuzz_verifyReveal(uint8[10] memory h, uint8[10] memory a, bytes32 salt, bytes32 otherSalt) public {
        vm.assume(salt != otherSalt);
        uint8[] memory home = new uint8[](10);
        uint8[] memory away = new uint8[](10);
        for (uint256 i = 0; i < 10; ++i) {
            home[i] = uint8(bound(h[i], 0, 9));
            away[i] = uint8(bound(a[i], 0, 9));
        }
        bytes32 ph = CommitmentLib.predictionsHash(home, away);
        bytes32 c = mw.computeCommitment(alice, ID, ph, salt);
        vm.prank(alice);
        mw.commit(ID, c);

        assertTrue(mw.verifyReveal(alice, ID, ph, salt), "valid reveal");
        assertFalse(mw.verifyReveal(alice, ID, ph, otherSalt), "wrong salt");
        assertFalse(mw.verifyReveal(bob, ID, ph, salt), "wrong player");
        home[0] = home[0] == 9 ? 0 : home[0] + 1;
        assertFalse(mw.verifyReveal(alice, ID, CommitmentLib.predictionsHash(home, away), salt), "tampered picks");
    }

    function test_verifyReveal_falseWithoutCommit() public view {
        assertFalse(mw.verifyReveal(alice, ID, keccak256("p"), keccak256("s")), "no commit");
    }

    function test_computeCommitment_unknownMatchweekReverts() public {
        vm.expectRevert(abi.encodeWithSelector(INorthesideMatchweeks.UnknownMatchweek.selector, 404));
        mw.computeCommitment(alice, 404, keccak256("p"), keccak256("s"));
    }

    function _finalize() internal {
        vm.warp(lockTime);
        vm.prank(results);
        mw.proposeResults(ID, keccak256("r"), "ipfs://e");
        vm.warp(block.timestamp + 12 hours);
        vm.prank(results);
        mw.finalize(ID, keccak256("rev"), keccak256("scores"));
    }
}

/// @notice Golden vectors from test/fixtures/golden-vectors.json; packages/commitments checks the
///         same constants in TypeScript.
contract CommitmentGoldenTest is Base {
    function test_golden_predictionsHashAndCommitment() public pure {
        uint8[] memory home = new uint8[](10);
        uint8[] memory away = new uint8[](10);
        uint8[10] memory h = [2, 1, 0, 3, 1, 2, 0, 1, 2, 1];
        uint8[10] memory a = [1, 1, 0, 2, 0, 2, 1, 0, 3, 0];
        for (uint256 i = 0; i < 10; ++i) {
            home[i] = h[i];
            away[i] = a[i];
        }
        bytes32 ph = CommitmentLib.predictionsHash(home, away);
        assertEq(ph, 0xfa61aa58ff916dea0a1f8867c21c48358c74b4fc9020bb3ff00c25cac70fd692, "predictionsHash");

        bytes32 fixturesRoot = 0x1111111111111111111111111111111111111111111111111111111111111111;
        bytes32 salt = 0x4242424242424242424242424242424242424242424242424242424242424242;
        address contractAddr = 0x5FbDB2315678afecb367f032d93F642f64180aa3;
        address player = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

        assertEq(
            CommitmentLib.commitment(1990, contractAddr, player, 11, fixturesRoot, ph, salt),
            0x0639aa0bd046ece58f43455acb28452abf44f14924186ea05ae33f28f577bc44,
            "mainnet commitment"
        );
        assertEq(
            CommitmentLib.commitment(1983, contractAddr, player, 11, fixturesRoot, ph, salt),
            0x21271ce9ed3be7a319a96b60fa37c84538fb16b109dc6665d3abdc6a95bf546b,
            "chain id changes the commitment"
        );
    }
}
