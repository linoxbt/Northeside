// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {vm} from "./utils/Vm.sol";
import {Merkle} from "./utils/Merkle.sol";
import {NSDFixture} from "./NSDRewards.t.sol";
import {NorthesideToken} from "../src/NorthesideToken.sol";
import {NSDRewards} from "../src/NSDRewards.sol";

/// @notice Drives NSDRewards through random sequences of every action.
contract NSDHandler {
    NSDRewards internal rewards;
    NorthesideToken internal token;
    address internal operator;
    address internal admin;
    address internal pauser;
    address internal treasury;
    address[3] internal wallets;

    struct Live {
        uint32 mw;
        bytes32[] leaves;
        uint128[3] amounts;
    }

    mapping(uint32 => Live) internal live;
    uint32[2] internal ids = [uint32(11), uint32(12)];
    uint256 public posts;
    uint256 public claims;
    uint256 public releases;
    uint256 public voids;
    /// @notice Successful claims by either of Ada's wallets (one person), per matchweek.
    mapping(uint32 => uint256) public adaClaims;

    constructor(NSDRewards r, NorthesideToken t, address op, address ad, address pa, address tr, address[3] memory w) {
        rewards = r;
        token = t;
        operator = op;
        admin = ad;
        pauser = pa;
        treasury = tr;
        wallets = w;
    }

    function _leaves(uint32 mw, uint128[3] memory a) internal view returns (bytes32[] memory l) {
        l = new bytes32[](3);
        for (uint256 i = 0; i < 3; ++i) l[i] = rewards.leafHash(mw, wallets[i], a[i]);
    }

    function post(uint256 seed, uint128 a, uint128 b, uint128 c, bool replace) external {
        uint32 mw = ids[seed % 2];
        uint128[3] memory x = [1 + (a % 400_000e18), 1 + (b % 400_000e18), 1 + (c % 400_000e18)];
        bytes32[] memory l = _leaves(mw, x);
        vm.prank(operator);
        if (replace) {
            try rewards.replaceRoot(mw, Merkle.root(l), x[0] + x[1] + x[2], "ipfs://r") {
                live[mw].mw = mw;
                live[mw].leaves = l;
                live[mw].amounts = x;
            } catch {}
        } else {
            try rewards.postRoot(mw, Merkle.root(l), x[0] + x[1] + x[2], "ipfs://p") {
                live[mw].mw = mw;
                live[mw].leaves = l;
                live[mw].amounts = x;
                ++posts;
            } catch {}
        }
    }

    function claim(uint256 seed, uint256 who) external {
        uint32 mw = ids[seed % 2];
        Live storage L = live[mw];
        if (L.mw == 0) return;
        uint256 i = who % 3;
        try rewards.claim(mw, wallets[i], L.amounts[i], Merkle.proof(L.leaves, i)) {
            ++claims;
            if (i < 2) ++adaClaims[mw];
        } catch {}
    }

    function voidRoot(uint256 seed) external {
        uint32 mw = ids[seed % 2];
        vm.prank(admin);
        try rewards.voidRoot(mw) {
            delete live[mw];
            ++voids;
        } catch {}
    }

    function release(uint256 seed) external {
        try rewards.release(ids[seed % 2]) {
            ++releases;
        } catch {}
    }

    function withdraw(uint128 amount) external {
        vm.prank(admin);
        try rewards.withdrawAvailable(treasury, 1 + (amount % 500_000e18)) {} catch {}
    }

    function pauseToggle(bool on) external {
        if (on) {
            vm.prank(pauser);
            try rewards.pause() {} catch {}
        } else {
            vm.prank(admin);
            try rewards.unpause() {} catch {}
        }
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + (secs % 40 days));
    }
}

contract NSDRewardsInvariantTest is NSDFixture {
    NSDHandler internal handler;

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        rewards.setMaxPerMatchweek(type(uint128).max);
        handler = new NSDHandler(rewards, token, operator, admin, pauser, treasury, [ada, adaAlt, bo]);
    }

    function targetContracts() public view returns (address[] memory t) {
        t = new address[](1);
        t[0] = address(handler);
    }

    /// @notice The pool can always pay every outstanding claim, and outstanding is exactly what live roots still owe.
    function invariant_solventAndExact() public view {
        assertGe(token.balanceOf(address(rewards)), rewards.outstanding(), "balance >= outstanding");
        uint256 owed;
        for (uint32 mwId = 11; mwId <= 12; ++mwId) {
            NSDRewards.Root memory r = rewards.rootOf(mwId);
            assertLe(r.claimed, r.allocated, "claimed <= allocated");
            if (r.root != bytes32(0) && !r.released) owed += r.allocated - r.claimed;
        }
        assertEq(rewards.outstanding(), owed, "outstanding == live roots' unclaimed allocation");
    }

    /// @notice Ada's two wallets (one person) claim at most once per matchweek (a root is posted once:
    ///         a void deletes it before any claim, so one live root per matchweek ever pays out).
    function invariant_onePersonOneClaim() public view {
        assertLe(handler.adaClaims(11), 1, "Ada claimed MW11 at most once");
        assertLe(handler.adaClaims(12), 1, "Ada claimed MW12 at most once");
    }

    /// @notice No tokens appear or vanish: pool + paid out + withdrawn = what the pool was funded with.
    function invariant_conservation() public view {
        uint256 paid = token.balanceOf(ada) + token.balanceOf(adaAlt) + token.balanceOf(bo);
        uint256 withdrawn = token.balanceOf(treasury) - 99_000_000e18;
        assertEq(paid + withdrawn + token.balanceOf(address(rewards)), 1_000_000e18, "conservation");
    }

    function test_handler_pathsLand() public {
        handler.post(0, 100e18, 200e18, 300e18, false);
        handler.warp(1 days);
        handler.claim(0, 0);
        handler.claim(0, 1); // Ada's second wallet: refused
        handler.claim(0, 2);
        handler.post(1, 5e18, 5e18, 5e18, false);
        handler.voidRoot(1);
        handler.warp(39 days);
        handler.warp(39 days);
        handler.warp(39 days);
        handler.release(0);
        assertEq(handler.posts(), 2, "posted");
        assertEq(handler.claims(), 2, "two people claimed");
        assertEq(handler.voids(), 1, "voided");
        assertEq(handler.releases(), 1, "released");
        assertEq(handler.adaClaims(11), 1, "Ada's second wallet was refused");
        invariant_solventAndExact();
        invariant_onePersonOneClaim();
        invariant_conservation();
    }
}
