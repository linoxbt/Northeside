// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {vm} from "./utils/Vm.sol";
import {Base} from "./utils/Base.sol";
import {Merkle} from "./utils/Merkle.sol";
import {NorthesideMatchweeks} from "../src/NorthesideMatchweeks.sol";
import {IdentityAdapter} from "../src/IdentityAdapter.sol";
import {NorthesideToken} from "../src/NorthesideToken.sol";
import {NSDRewards, IPersonRegistry} from "../src/NSDRewards.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Shared setup: finalized matchweeks 11 and 12, an open 13, a real IdentityAdapter, the
///         $NSD token and a rewards pool funded with 1,000,000 NSD.
abstract contract NSDFixture is Base {
    uint128 internal constant NSD = 1e18;
    uint128 internal constant CAP = 100_000 * NSD;

    NorthesideMatchweeks internal mw;
    IdentityAdapter internal id;
    NorthesideToken internal token;
    NSDRewards internal rewards;

    address internal admin = makeAddr("admin");
    address internal operator = makeAddr("operator");
    address internal resultsKey = makeAddr("results");
    address internal pauser = makeAddr("pauser");
    address internal attester = makeAddr("attester");
    address internal treasury = makeAddr("treasury");
    address internal ada = makeAddr("ada");
    address internal adaAlt = makeAddr("adaAlt"); // Ada's second wallet, same person
    address internal bo = makeAddr("bo");
    address internal bot = makeAddr("bot"); // never verified
    address internal stranger = makeAddr("stranger");

    function setUp() public virtual {
        vm.warp(1_763_000_000);
        address[] memory challengers = new address[](1);
        challengers[0] = makeAddr("challenger");
        mw = new NorthesideMatchweeks(admin, operator, resultsKey, pauser, challengers);
        id = new IdentityAdapter(admin, attester);
        token = new NorthesideToken("Northeside", "NSD", 100_000_000 * uint256(NSD), treasury);
        rewards = new NSDRewards(admin, operator, pauser, IERC20(address(token)), mw, IPersonRegistry(address(id)), CAP);
        vm.prank(treasury);
        token.transfer(address(rewards), 1_000_000 * uint256(NSD));

        vm.startPrank(attester);
        id.attest(ada, keccak256("person:ada"));
        id.attest(adaAlt, keccak256("person:ada"));
        id.attest(bo, keccak256("person:bo"));
        vm.stopPrank();

        _createAndFinalize(11);
        _createAndFinalize(12);
        vm.prank(operator);
        mw.createMatchweek(13, keccak256("f13"), uint64(block.timestamp + 1 days), uint64(block.timestamp + 1 days), 10, keccak256("rules"));
    }

    function _createAndFinalize(uint32 mwId) internal {
        vm.prank(operator);
        mw.createMatchweek(mwId, keccak256(abi.encode("f", mwId)), uint64(block.timestamp + 1 hours), uint64(block.timestamp + 1 hours), 10, keccak256("rules"));
        vm.warp(block.timestamp + 1 hours);
        vm.prank(resultsKey);
        mw.proposeResults(mwId, keccak256(abi.encode("r", mwId)), keccak256("rev"), keccak256("scores"), "ipfs://e");
        vm.warp(block.timestamp + 12 hours);
        vm.prank(resultsKey);
        mw.finalize(mwId);
    }

    struct Tree {
        bytes32 root;
        bytes32[] leaves;
        uint128 total;
    }

    function _tree(uint32 mwId, address[] memory wallets, uint128[] memory amounts) internal view returns (Tree memory t) {
        t.leaves = new bytes32[](wallets.length);
        for (uint256 i = 0; i < wallets.length; ++i) {
            t.leaves[i] = rewards.leafHash(mwId, wallets[i], amounts[i]);
            t.total += amounts[i];
        }
        t.root = Merkle.root(t.leaves);
    }

    function _three(uint32 mwId, uint128 a, uint128 b, uint128 c) internal view returns (Tree memory) {
        address[] memory w = new address[](3);
        w[0] = ada;
        w[1] = adaAlt;
        w[2] = bo;
        uint128[] memory x = new uint128[](3);
        x[0] = a;
        x[1] = b;
        x[2] = c;
        return _tree(mwId, w, x);
    }
}

contract NSDTokenTest is NSDFixture {
    function test_fixedSupply_noMinting() public view {
        assertEq(token.totalSupply(), 100_000_000 * uint256(NSD), "supply");
        assertEq(token.balanceOf(treasury), 99_000_000 * uint256(NSD), "treasury after funding the pool");
        assertEq(uint256(token.decimals()), 18, "decimals");
        assertTrue(keccak256(bytes(token.symbol())) == keccak256("NSD"), "symbol");
    }

    function test_constructorGuards() public {
        vm.expectRevert(NorthesideToken.InvalidParams.selector);
        new NorthesideToken("Northeside", "NSD", 0, treasury);
        vm.expectRevert(NorthesideToken.InvalidParams.selector);
        new NorthesideToken("Northeside", "NSD", 1, address(0));
    }
}

contract NSDRewardsTest is NSDFixture {
    /// @dev test/fixtures/golden-vectors.json -> nsdRewardLeaf (also checked by packages/merkle).
    function test_golden_leafHash() public view {
        assertEq(
            rewards.leafHash(11, 0x70997970C51812dc3A010C7d01b50e0d17dc79C8, 2_500 * NSD),
            0x5f416a6536786c6583845ce47109921861c8e59568b4738e26dd9ae0b1ef9893,
            "golden nsd leaf"
        );
    }

    function test_postAndClaim_afterDelay() public {
        Tree memory t = _three(11, 500 * NSD, 300 * NSD, 200 * NSD);
        vm.prank(operator);
        rewards.postRoot(11, t.root, t.total, "ipfs://nsd-11");
        assertEq(uint256(rewards.outstanding()), 1_000 * uint256(NSD), "outstanding");

        vm.expectRevert(abi.encodeWithSelector(NSDRewards.ClaimNotOpen.selector, uint32(11)));
        rewards.claim(11, bo, 200 * NSD, Merkle.proof(t.leaves, 2));

        vm.warp(block.timestamp + 24 hours);
        vm.prank(stranger); // anyone may submit; tokens go to the listed wallet
        rewards.claim(11, bo, 200 * NSD, Merkle.proof(t.leaves, 2));
        assertEq(token.balanceOf(bo), 200 * uint256(NSD), "bo paid");
        assertEq(uint256(rewards.outstanding()), 800 * uint256(NSD), "outstanding down");

        vm.expectRevert(abi.encodeWithSelector(NSDRewards.PersonAlreadyClaimed.selector, uint32(11)));
        rewards.claim(11, bo, 200 * NSD, Merkle.proof(t.leaves, 2));
    }

    /// @dev Anti-farming on-chain: two wallets of one person in a root still claim once.
    function test_onePersonOneClaimPerMatchweek() public {
        Tree memory t = _three(11, 500 * NSD, 300 * NSD, 200 * NSD);
        vm.prank(operator);
        rewards.postRoot(11, t.root, t.total, "ipfs://nsd-11");
        vm.warp(block.timestamp + 24 hours);
        rewards.claim(11, ada, 500 * NSD, Merkle.proof(t.leaves, 0));
        vm.expectRevert(abi.encodeWithSelector(NSDRewards.PersonAlreadyClaimed.selector, uint32(11)));
        rewards.claim(11, adaAlt, 300 * NSD, Merkle.proof(t.leaves, 1));
        assertEq(token.balanceOf(adaAlt), 0, "second wallet unpaid");
    }

    function test_unverifiedWalletCannotClaim_evenIfListed() public {
        address[] memory w = new address[](2);
        w[0] = bot;
        w[1] = bo;
        uint128[] memory x = new uint128[](2);
        x[0] = 100 * NSD;
        x[1] = 100 * NSD;
        Tree memory t = _tree(11, w, x);
        vm.prank(operator);
        rewards.postRoot(11, t.root, t.total, "ipfs://nsd-11");
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(abi.encodeWithSelector(NSDRewards.NotVerified.selector, bot));
        rewards.claim(11, bot, 100 * NSD, Merkle.proof(t.leaves, 0));

        // Verification revoked (e.g. a fraud finding) before claiming: no claim either.
        vm.prank(attester);
        id.revoke(bo);
        vm.expectRevert(abi.encodeWithSelector(NSDRewards.NotVerified.selector, bo));
        rewards.claim(11, bo, 100 * NSD, Merkle.proof(t.leaves, 1));
    }

    function test_badProofAndWrongAmount() public {
        Tree memory t = _three(11, 500 * NSD, 300 * NSD, 200 * NSD);
        vm.prank(operator);
        rewards.postRoot(11, t.root, t.total, "ipfs://nsd-11");
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(NSDRewards.InvalidProof.selector);
        rewards.claim(11, bo, 999 * NSD, Merkle.proof(t.leaves, 2));
        vm.expectRevert(NSDRewards.InvalidProof.selector);
        rewards.claim(11, bo, 200 * NSD, Merkle.proof(t.leaves, 0));
    }

    function test_postRoot_guards() public {
        Tree memory t = _three(13, 1, 1, 1);
        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(NSDRewards.NotFinalized.selector, uint32(13)));
        rewards.postRoot(13, t.root, t.total, "ipfs://x");
        Tree memory big = _three(11, CAP, 1, 0);
        vm.expectRevert(NSDRewards.OverCap.selector);
        rewards.postRoot(11, big.root, big.total, "ipfs://x");
        vm.expectRevert(NSDRewards.InvalidParams.selector);
        rewards.postRoot(11, t.root, t.total, "");
        Tree memory ok = _three(11, 1, 1, 1);
        rewards.postRoot(11, ok.root, ok.total, "ipfs://x");
        vm.expectRevert(abi.encodeWithSelector(NSDRewards.RootExists.selector, uint32(11)));
        rewards.postRoot(11, ok.root, ok.total, "ipfs://x");
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, rewards.OPERATOR_ROLE()));
        vm.prank(stranger);
        rewards.postRoot(12, ok.root, ok.total, "ipfs://x");
    }

    /// @dev A root can never allocate tokens the pool does not hold beyond what is already owed.
    function test_cannotOverAllocateThePool() public {
        vm.prank(admin);
        rewards.setMaxPerMatchweek(type(uint128).max);
        Tree memory a = _three(11, 600_000 * NSD, 0, 0);
        vm.prank(operator);
        rewards.postRoot(11, a.root, a.total, "ipfs://a");
        Tree memory b = _three(12, 400_001 * NSD, 0, 0);
        vm.expectRevert(NSDRewards.InsufficientPool.selector);
        vm.prank(operator);
        rewards.postRoot(12, b.root, b.total, "ipfs://b");
        vm.expectRevert(NSDRewards.InsufficientPool.selector);
        vm.prank(admin);
        rewards.withdrawAvailable(treasury, 400_001 * NSD);
        vm.prank(admin);
        rewards.withdrawAvailable(treasury, 400_000 * NSD);
        assertEq(rewards.available(), 0, "pool fully committed");
    }

    function test_replaceAndVoid_onlyBeforeClaims() public {
        Tree memory t = _three(11, 500 * NSD, 300 * NSD, 200 * NSD);
        vm.prank(operator);
        rewards.postRoot(11, t.root, t.total, "ipfs://1");
        vm.warp(block.timestamp + 23 hours);

        // Correct it: the review delay restarts.
        Tree memory fix = _three(11, 400 * NSD, 0, 100 * NSD);
        vm.prank(operator);
        rewards.replaceRoot(11, fix.root, fix.total, "ipfs://2");
        assertEq(uint256(rewards.outstanding()), 500 * uint256(NSD), "outstanding follows the new root");
        vm.warp(block.timestamp + 23 hours);
        vm.expectRevert(abi.encodeWithSelector(NSDRewards.ClaimNotOpen.selector, uint32(11)));
        rewards.claim(11, bo, 100 * NSD, Merkle.proof(fix.leaves, 2));
        vm.warp(block.timestamp + 1 hours);
        // The old root's leaves are dead.
        vm.expectRevert(NSDRewards.InvalidProof.selector);
        rewards.claim(11, bo, 200 * NSD, Merkle.proof(t.leaves, 2));
        rewards.claim(11, bo, 100 * NSD, Merkle.proof(fix.leaves, 2));

        // After a claim, neither replace nor void is possible.
        vm.expectRevert(abi.encodeWithSelector(NSDRewards.AlreadyClaimedFrom.selector, uint32(11)));
        vm.prank(operator);
        rewards.replaceRoot(11, t.root, t.total, "ipfs://3");
        vm.expectRevert(abi.encodeWithSelector(NSDRewards.AlreadyClaimedFrom.selector, uint32(11)));
        vm.prank(admin);
        rewards.voidRoot(11);

        // Void a fresh bad root; the matchweek can then take a new one.
        Tree memory bad = _three(12, 50_000 * NSD, 0, 0);
        vm.prank(operator);
        rewards.postRoot(12, bad.root, bad.total, "ipfs://bad");
        vm.prank(admin);
        rewards.voidRoot(12);
        assertEq(uint256(rewards.outstanding()), 400 * uint256(NSD), "void frees the allocation");
        Tree memory good = _three(12, 10 * NSD, 0, 10 * NSD);
        vm.prank(operator);
        rewards.postRoot(12, good.root, good.total, "ipfs://good");
    }

    function test_releaseAfterWindow() public {
        Tree memory t = _three(11, 500 * NSD, 300 * NSD, 200 * NSD);
        vm.prank(operator);
        rewards.postRoot(11, t.root, t.total, "ipfs://1");
        vm.warp(block.timestamp + 24 hours);
        rewards.claim(11, ada, 500 * NSD, Merkle.proof(t.leaves, 0));
        vm.expectRevert(abi.encodeWithSelector(NSDRewards.ClaimWindowOpen.selector, uint32(11)));
        rewards.release(11);
        vm.warp(block.timestamp + 90 days);
        vm.expectRevert(abi.encodeWithSelector(NSDRewards.ClaimWindowOver.selector, uint32(11)));
        rewards.claim(11, bo, 200 * NSD, Merkle.proof(t.leaves, 2));
        uint256 before = rewards.available();
        rewards.release(11);
        // Ada's second wallet (300) and Bo (200) never claimed: 500 goes back to the pool.
        assertEq(rewards.available() - before, 500 * uint256(NSD), "unclaimed shares back in the pool");
        assertEq(uint256(rewards.outstanding()), 0, "nothing outstanding");
        vm.expectRevert(abi.encodeWithSelector(NSDRewards.NoRoot.selector, uint32(11)));
        rewards.release(11);
        Tree memory again = _three(11, 1, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(NSDRewards.RootExists.selector, uint32(11)));
        vm.prank(operator);
        rewards.postRoot(11, again.root, again.total, "ipfs://again");
    }

    function test_pause_onlyAdminUnpauses() public {
        Tree memory t = _three(11, 500 * NSD, 300 * NSD, 200 * NSD);
        vm.prank(operator);
        rewards.postRoot(11, t.root, t.total, "ipfs://1");
        vm.warp(block.timestamp + 24 hours);
        vm.prank(pauser);
        rewards.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        rewards.claim(11, bo, 200 * NSD, Merkle.proof(t.leaves, 2));
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, pauser, bytes32(0)));
        vm.prank(pauser);
        rewards.unpause();
        vm.prank(admin);
        rewards.unpause();
        rewards.claim(11, bo, 200 * NSD, Merkle.proof(t.leaves, 2));
    }

    function test_constructorGuards() public {
        vm.expectRevert(NSDRewards.InvalidParams.selector);
        new NSDRewards(admin, operator, pauser, IERC20(address(token)), mw, IPersonRegistry(address(id)), 0);
        vm.expectRevert(NSDRewards.InvalidParams.selector);
        new NSDRewards(address(0), operator, pauser, IERC20(address(token)), mw, IPersonRegistry(address(id)), CAP);
    }

    function testFuzz_claimNeverExceedsAllocation(uint128 a, uint128 b, uint128 c) public {
        a = uint128(bound(a, 1, 300_000 * NSD));
        b = uint128(bound(b, 1, 300_000 * NSD));
        c = uint128(bound(c, 1, 300_000 * NSD));
        vm.prank(admin);
        rewards.setMaxPerMatchweek(type(uint128).max);
        Tree memory t = _three(11, a, b, c);
        vm.prank(operator);
        rewards.postRoot(11, t.root, t.total, "ipfs://f");
        vm.warp(block.timestamp + 24 hours);
        rewards.claim(11, ada, a, Merkle.proof(t.leaves, 0));
        rewards.claim(11, bo, c, Merkle.proof(t.leaves, 2));
        assertEq(token.balanceOf(address(rewards)), 1_000_000 * uint256(NSD) - a - c, "balance");
        assertGe(token.balanceOf(address(rewards)), rewards.outstanding(), "always solvent");
    }
}
