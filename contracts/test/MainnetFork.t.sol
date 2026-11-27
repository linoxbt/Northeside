// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {vm} from "./utils/Vm.sol";
import {Base} from "./utils/Base.sol";
import {NorthesideMatchweeks} from "../src/NorthesideMatchweeks.sol";
import {IdentityAdapter} from "../src/IdentityAdapter.sol";
import {NSDRewards} from "../src/NSDRewards.sol";

/// @notice Runs against the contracts actually deployed on QIE mainnet (v1 Matchweeks, HostRewards and
///         IdentityAdapter; NSDRewards), on a fork, so the app's assumptions are checked against live
///         bytecode and not only against the current source (audit 27 Nov, missing 3). Opt in with
///         FORK_MAINNET=1 (it needs the QIE RPC); without it every test returns at once.
///         Addresses come from deployments/1990*.json, never from code.
contract MainnetForkTest is Base {
    NorthesideMatchweeks internal mw;
    IdentityAdapter internal id;
    NSDRewards internal nsd;
    address internal admin;
    address internal operator;
    address internal attester;
    address internal pauser;
    bool internal on;

    function setUp() public {
        on = vm.envOr("FORK_MAINNET", uint256(0)) == 1;
        if (!on) return;
        vm.createSelectFork(vm.envOr("QIE_MAINNET_RPC", string("https://rpc1mainnet.qie.digital/")));
        string memory core = vm.readFile("./deployments/1990.json");
        string memory tok = vm.readFile("./deployments/1990-nsd.json");
        string memory roles = vm.readFile("./deployments/1990-roles.json");
        mw = NorthesideMatchweeks(vm.parseJsonAddress(core, ".matchweeks"));
        id = IdentityAdapter(vm.parseJsonAddress(core, ".identity"));
        nsd = NSDRewards(vm.parseJsonAddress(tok, ".rewards"));
        admin = vm.parseJsonAddress(roles, ".admin");
        operator = vm.parseJsonAddress(roles, ".operator");
        attester = vm.parseJsonAddress(roles, ".attester");
        pauser = vm.parseJsonAddress(roles, ".pauser");
    }

    /// The live roles are where the docs say they are.
    function test_fork_rolesAsDocumented() public view {
        if (!on) return;
        assertTrue(mw.hasRole(mw.DEFAULT_ADMIN_ROLE(), admin), "matchweeks admin");
        assertTrue(mw.hasRole(mw.OPERATOR_ROLE(), operator), "matchweeks operator");
        assertTrue(id.hasRole(id.ATTESTER_ROLE(), attester), "identity attester");
        assertTrue(nsd.hasRole(nsd.PAUSER_ROLE(), pauser), "nsd pauser");
        assertTrue(nsd.hasRole(nsd.DEFAULT_ADMIN_ROLE(), admin), "nsd admin");
    }

    /// A player's commit on the live v1 contract: the commitment the app computes is what is stored.
    function test_fork_commitOnLiveMatchweek() public {
        if (!on) return;
        uint32 open = _openMatchweek();
        if (open == 0) return; // between matchweeks: nothing open to commit to
        address player = makeAddr("fork-player");
        bytes32 c = mw.computeCommitment(player, open, keccak256("picks"), keccak256("salt"));
        vm.prank(player);
        mw.commit(open, c);
        (bytes32 stored, uint32 version) = mw.commitmentOf(open, player);
        assertEq(stored, c, "commitment stored");
        assertEq(version, 1, "first seal");
        assertTrue(mw.verifyReveal(player, open, keccak256("picks"), keccak256("salt")), "reveal verifies");
    }

    /// The pool-drain path from the 27 Nov audit (S1), on live bytecode: the operator key alone can post
    /// a root for a finalized week; the response the alert asks for (admin voidRoot, pauser pause)
    /// works and returns every token to the pool.
    function test_fork_unexpectedNsdRootCanBeVoidedAndPaused() public {
        if (!on) return;
        if (!mw.isFinalized(11) || nsd.rootOf(11).root != bytes32(0)) return;
        uint256 before = nsd.available();
        if (before == 0) return;
        vm.prank(operator);
        nsd.postRoot(11, keccak256("not-northeside"), uint128(before), "ipfs://fake");
        assertEq(nsd.available(), 0, "allocated");
        vm.prank(admin);
        nsd.voidRoot(11);
        assertEq(nsd.available(), before, "voided: back in the pool");
        vm.prank(pauser);
        nsd.pause();
        assertTrue(nsd.paused(), "pauser can stop it");
    }

    /// Verification on the live v1 IdentityAdapter: the attester links a wallet to one person.
    function test_fork_attesterLinksWallet() public {
        if (!on) return;
        address wallet = makeAddr("fork-verified");
        vm.prank(attester);
        id.attest(wallet, keccak256("person"));
        assertEq(id.personOf(wallet), keccak256("person"), "linked");
    }

    function _openMatchweek() internal view returns (uint32) {
        for (uint32 w = 20; w >= 11; w--) {
            NorthesideMatchweeks.Matchweek memory m = mw.matchweek(w);
            if (uint8(m.status) == 1 && block.timestamp < m.lockTime) return w;
        }
        return 0;
    }
}
