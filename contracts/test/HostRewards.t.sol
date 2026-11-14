// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {vm} from "./utils/Vm.sol";
import {Base} from "./utils/Base.sol";
import {Merkle} from "./utils/Merkle.sol";
import {MockERC20, FeeOnTransferERC20, ReentrantERC20, IClaimTarget} from "./mocks/MockERC20.sol";
import {NorthesideMatchweeks} from "../src/NorthesideMatchweeks.sol";
import {INorthesideMatchweeks} from "../src/interfaces/INorthesideMatchweeks.sol";
import {HostRewards} from "../src/HostRewards.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Shared setup: a matchweeks contract with finalized matchweeks 11 and 12, an open 13,
///         and a HostRewards with the launch caps (500 / 2,000 QUSDC).
abstract contract HostRewardsFixture is Base {
    uint128 internal constant ONE = 1e6; // 1 QUSDC
    uint128 internal constant CAP_CAMPAIGN = 500 * ONE;
    uint128 internal constant CAP_TOTAL = 2_000 * ONE;

    NorthesideMatchweeks internal mw;
    HostRewards internal rewards;
    MockERC20 internal qusdc;

    address internal admin = makeAddr("admin");
    address internal operator = makeAddr("operator");
    address internal resultsKey = makeAddr("results");
    address internal pauser = makeAddr("pauser");
    address internal treasury = makeAddr("treasury");
    address internal sponsor = makeAddr("sponsor");
    address internal hostA = makeAddr("hostA");
    address internal hostB = makeAddr("hostB");
    address internal stranger = makeAddr("stranger");

    uint64 internal expiry;

    function setUp() public virtual {
        vm.warp(1_763_000_000);
        address[] memory challengers = new address[](1);
        challengers[0] = makeAddr("challenger");
        mw = new NorthesideMatchweeks(admin, operator, resultsKey, pauser, challengers);
        qusdc = new MockERC20();
        rewards = new HostRewards(
            admin, operator, pauser, IERC20(address(qusdc)), mw, treasury, CAP_CAMPAIGN, CAP_TOTAL
        );

        _createAndFinalize(11);
        _createAndFinalize(12);
        vm.prank(operator);
        mw.createMatchweek(
            13,
            keccak256("f13"),
            uint64(block.timestamp + 1 days),
            uint64(block.timestamp + 1 days),
            10,
            keccak256("rules")
        );

        expiry = uint64(block.timestamp + 30 days);
        qusdc.mint(sponsor, 10_000 * ONE);
    }

    function _createAndFinalize(uint32 id) internal {
        vm.prank(operator);
        mw.createMatchweek(
            id,
            keccak256(abi.encode("f", id)),
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 1 hours),
            10,
            keccak256("rules")
        );
        vm.warp(block.timestamp + 1 hours);
        vm.prank(resultsKey);
        mw.proposeResults(
            id, keccak256(abi.encode("r", id)), keccak256("rev"), keccak256("scores"), "ipfs://e"
        );
        vm.warp(block.timestamp + 12 hours);
        vm.prank(resultsKey);
        mw.finalize(id);
    }

    function _terms(uint128 gross, uint16 feeBps) internal view returns (HostRewards.Terms memory t) {
        t = HostRewards.Terms({
            sponsor: sponsor,
            grossAmount: gross,
            feeBps: feeBps,
            ratePerPlayer: ONE / 10,
            capPerHost: 50 * ONE,
            firstMatchweek: 11,
            lastMatchweek: 14,
            expiry: expiry,
            leaguesHash: keccak256("leagues"),
            termsHash: keccak256("terms-v1")
        });
    }

    function _createFunded(uint128 gross, uint16 feeBps) internal returns (uint256 id) {
        vm.prank(operator);
        id = rewards.createCampaign(_terms(gross, feeBps));
        vm.startPrank(sponsor);
        qusdc.approve(address(rewards), gross);
        rewards.fund(id);
        vm.stopPrank();
    }

    struct Tree {
        bytes32 root;
        bytes32[] leaves;
        uint128 total;
    }

    function _tree(
        uint256 id,
        uint32 mwId,
        address[] memory hosts,
        uint128[] memory amounts,
        uint32[] memory players
    ) internal view returns (Tree memory t) {
        t.leaves = new bytes32[](hosts.length);
        for (uint256 i = 0; i < hosts.length; ++i) {
            t.leaves[i] = rewards.leafHash(id, mwId, hosts[i], amounts[i], players[i]);
            t.total += amounts[i];
        }
        t.root = Merkle.root(t.leaves);
    }

    function _twoHostTree(uint256 id, uint32 mwId, uint128 a, uint128 b) internal view returns (Tree memory) {
        address[] memory hosts = new address[](2);
        hosts[0] = hostA;
        hosts[1] = hostB;
        uint128[] memory amounts = new uint128[](2);
        amounts[0] = a;
        amounts[1] = b;
        uint32[] memory players = new uint32[](2);
        players[0] = 25;
        players[1] = 10;
        return _tree(id, mwId, hosts, amounts, players);
    }
}

contract HostRewardsTest is HostRewardsFixture {
    // ------------------------------------------------------------ construction

    function test_constructor_rejectsBadParams() public {
        vm.expectRevert(HostRewards.InvalidParams.selector);
        new HostRewards(admin, operator, pauser, IERC20(address(0)), mw, treasury, CAP_CAMPAIGN, CAP_TOTAL);
        vm.expectRevert(HostRewards.InvalidParams.selector);
        new HostRewards(
            admin, operator, pauser, IERC20(address(qusdc)), mw, address(0), CAP_CAMPAIGN, CAP_TOTAL
        );
        vm.expectRevert(HostRewards.InvalidParams.selector);
        new HostRewards(
            admin, operator, pauser, IERC20(address(qusdc)), mw, treasury, CAP_TOTAL, CAP_CAMPAIGN
        );
    }

    // ------------------------------------------------------------ createCampaign

    function test_create_computesBudgetAfterFee() public {
        vm.prank(operator);
        uint256 id = rewards.createCampaign(_terms(110 * ONE, 1_000));
        HostRewards.Campaign memory c = rewards.campaign(id);
        assertEq(id, 1, "first id");
        assertEq(c.budget, 99 * ONE, "budget = gross - 10%");
        assertEq(uint256(c.status), uint256(HostRewards.CampaignStatus.Pending), "pending");
        assertEq(qusdc.balanceOf(address(rewards)), 0, "nothing moves at create");
    }

    function test_create_onlyOperator() public {
        HostRewards.Terms memory t = _terms(100 * ONE, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, sponsor, rewards.OPERATOR_ROLE()
            )
        );
        vm.prank(sponsor);
        rewards.createCampaign(t);
    }

    function test_create_validatesTerms() public {
        vm.startPrank(operator);
        HostRewards.Terms memory t = _terms(100 * ONE, 1_001);
        vm.expectRevert(HostRewards.InvalidParams.selector);
        rewards.createCampaign(t); // fee above 10%

        t = _terms(100 * ONE, 0);
        t.firstMatchweek = 15;
        vm.expectRevert(HostRewards.InvalidParams.selector);
        rewards.createCampaign(t); // range inverted

        t = _terms(100 * ONE, 0);
        t.expiry = uint64(block.timestamp);
        vm.expectRevert(HostRewards.InvalidParams.selector);
        rewards.createCampaign(t); // already expired

        t = _terms(100 * ONE, 0);
        t.termsHash = bytes32(0);
        vm.expectRevert(HostRewards.InvalidParams.selector);
        rewards.createCampaign(t); // unsigned terms

        t = _terms(0, 0);
        vm.expectRevert(HostRewards.InvalidParams.selector);
        rewards.createCampaign(t);
        vm.stopPrank();
    }

    function test_create_enforcesCampaignCap() public {
        vm.prank(operator);
        rewards.createCampaign(_terms(CAP_CAMPAIGN, 0)); // exactly at cap is fine
        vm.expectRevert(HostRewards.CapExceeded.selector);
        vm.prank(operator);
        rewards.createCampaign(_terms(CAP_CAMPAIGN + 1, 0));
    }

    function test_cancel_onlyPending() public {
        vm.prank(operator);
        uint256 id = rewards.createCampaign(_terms(100 * ONE, 0));
        vm.prank(operator);
        rewards.cancelCampaign(id);
        assertEq(
            uint256(rewards.campaign(id).status), uint256(HostRewards.CampaignStatus.Cancelled), "cancelled"
        );

        uint256 funded = _createFunded(100 * ONE, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                HostRewards.WrongStatus.selector, funded, HostRewards.CampaignStatus.Active
            )
        );
        vm.prank(operator);
        rewards.cancelCampaign(funded);
    }

    // ------------------------------------------------------------ fund

    function test_fund_escrowsBudgetAndPaysFee() public {
        uint256 id = _createFunded(200 * ONE, 500); // 5% fee
        HostRewards.Campaign memory c = rewards.campaign(id);
        assertEq(uint256(c.status), uint256(HostRewards.CampaignStatus.Active), "active");
        assertEq(qusdc.balanceOf(treasury), 10 * ONE, "fee to treasury");
        assertEq(qusdc.balanceOf(address(rewards)), 190 * ONE, "budget escrowed");
        assertEq(rewards.totalLiability(), 190 * ONE, "liability");
    }

    function test_fund_onlySponsor() public {
        vm.prank(operator);
        uint256 id = rewards.createCampaign(_terms(100 * ONE, 0));
        vm.expectRevert(HostRewards.NotSponsor.selector);
        vm.prank(stranger);
        rewards.fund(id);
    }

    function test_fund_onlyOnce() public {
        uint256 id = _createFunded(100 * ONE, 0);
        vm.startPrank(sponsor);
        qusdc.approve(address(rewards), 100 * ONE);
        vm.expectRevert(
            abi.encodeWithSelector(HostRewards.WrongStatus.selector, id, HostRewards.CampaignStatus.Active)
        );
        rewards.fund(id);
        vm.stopPrank();
    }

    function test_fund_afterExpiryReverts() public {
        vm.prank(operator);
        uint256 id = rewards.createCampaign(_terms(100 * ONE, 0));
        vm.warp(expiry);
        vm.startPrank(sponsor);
        qusdc.approve(address(rewards), 100 * ONE);
        vm.expectRevert(abi.encodeWithSelector(HostRewards.Expired.selector, id));
        rewards.fund(id);
        vm.stopPrank();
    }

    function test_fund_enforcesTotalCap() public {
        for (uint256 i = 0; i < 4; ++i) {
            _createFunded(CAP_CAMPAIGN, 0); // 4 x 500 = 2,000
        }
        vm.prank(operator);
        uint256 id = rewards.createCampaign(_terms(ONE, 0));
        vm.startPrank(sponsor);
        qusdc.approve(address(rewards), ONE);
        vm.expectRevert(HostRewards.CapExceeded.selector);
        rewards.fund(id);
        vm.stopPrank();
    }

    function test_fund_pausedReverts() public {
        vm.prank(operator);
        uint256 id = rewards.createCampaign(_terms(100 * ONE, 0));
        vm.prank(pauser);
        rewards.pause();
        vm.startPrank(sponsor);
        qusdc.approve(address(rewards), 100 * ONE);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        rewards.fund(id);
        vm.stopPrank();
    }

    function test_fund_rejectsFeeOnTransferToken() public {
        FeeOnTransferERC20 feeToken = new FeeOnTransferERC20();
        HostRewards r2 = new HostRewards(
            admin, operator, pauser, IERC20(address(feeToken)), mw, treasury, CAP_CAMPAIGN, CAP_TOTAL
        );
        feeToken.mint(sponsor, 1_000 * ONE);
        vm.prank(operator);
        uint256 id = r2.createCampaign(_terms(100 * ONE, 0));
        vm.startPrank(sponsor);
        feeToken.approve(address(r2), 100 * ONE);
        vm.expectRevert(HostRewards.UnsupportedToken.selector);
        r2.fund(id);
        vm.stopPrank();
    }

    function testFuzz_feeMath(uint128 gross, uint16 feeBps) public view {
        gross = uint128(bound(gross, 1, type(uint128).max));
        feeBps = uint16(bound(feeBps, 0, rewards.MAX_FEE_BPS()));
        uint128 budget = rewards.budgetOf(gross, feeBps);
        uint256 fee = gross - budget;
        assertLe(budget, gross, "budget <= gross");
        assertLe(fee * 10_000, uint256(gross) * feeBps, "fee never exceeds feeBps");
    }

    // ------------------------------------------------------------ postRoot

    function test_postRoot_requiresFinalizedMatchweek() public {
        uint256 id = _createFunded(100 * ONE, 0);
        Tree memory t = _twoHostTree(id, 13, 5 * ONE, 5 * ONE);
        vm.expectRevert(abi.encodeWithSelector(HostRewards.MatchweekNotFinalized.selector, 13));
        vm.prank(operator);
        rewards.postRoot(id, 13, t.root, t.total, "ipfs://report");
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window
    }

    function test_postRoot_requiresRange() public {
        uint256 id = _createFunded(100 * ONE, 0);
        vm.expectRevert(abi.encodeWithSelector(HostRewards.MatchweekOutOfRange.selector, 10));
        vm.prank(operator);
        rewards.postRoot(id, 10, keccak256("r"), ONE, "ipfs://report");
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window
    }

    function test_postRoot_oncePerMatchweek() public {
        uint256 id = _createFunded(100 * ONE, 0);
        Tree memory t = _twoHostTree(id, 11, 5 * ONE, 5 * ONE);
        vm.startPrank(operator);
        rewards.postRoot(id, 11, t.root, t.total, "ipfs://report");
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window
        vm.expectRevert(abi.encodeWithSelector(HostRewards.RootExists.selector, id, 11));
        rewards.postRoot(id, 11, t.root, t.total, "ipfs://report");
        vm.stopPrank();
    }

    function test_postRoot_cannotExceedBudget() public {
        uint256 id = _createFunded(100 * ONE, 0);
        vm.startPrank(operator);
        rewards.postRoot(id, 11, keccak256("a"), 60 * ONE, "ipfs://r");
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window
        vm.expectRevert(HostRewards.OverBudget.selector);
        rewards.postRoot(id, 12, keccak256("b"), 41 * ONE, "ipfs://r");
        rewards.postRoot(id, 12, keccak256("b"), 40 * ONE, "ipfs://r"); // exactly the rest
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window
        assertEq(rewards.campaign(id).allocated, 100 * ONE, "fully allocated");
    }

    function test_postRoot_afterExpiryReverts() public {
        uint256 id = _createFunded(100 * ONE, 0);
        vm.warp(expiry);
        vm.expectRevert(abi.encodeWithSelector(HostRewards.Expired.selector, id));
        vm.prank(operator);
        rewards.postRoot(id, 11, keccak256("a"), ONE, "ipfs://r");
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window
    }

    function test_postRoot_onlyOperator() public {
        uint256 id = _createFunded(100 * ONE, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, sponsor, rewards.OPERATOR_ROLE()
            )
        );
        vm.prank(sponsor);
        rewards.postRoot(id, 11, keccak256("a"), ONE, "ipfs://r");
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window
    }

    // ------------------------------------------------------------ claim

    function test_claim_paysHostOnce() public {
        uint256 id = _createFunded(100 * ONE, 0);
        Tree memory t = _twoHostTree(id, 11, 7 * ONE, 3 * ONE);
        vm.prank(operator);
        rewards.postRoot(id, 11, t.root, t.total, "ipfs://report");
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window

        // anyone may submit; money goes to the host
        vm.expectEmit(true, true, true, true, address(rewards));
        emit HostRewards.Claimed(id, 11, hostA, 7 * ONE, 25);
        vm.prank(stranger);
        rewards.claim(id, 11, hostA, 7 * ONE, 25, Merkle.proof(t.leaves, 0));
        assertEq(qusdc.balanceOf(hostA), 7 * ONE, "host paid");
        assertEq(qusdc.balanceOf(stranger), 0, "submitter not paid");

        vm.expectRevert(HostRewards.AlreadyClaimed.selector);
        vm.prank(hostA);
        rewards.claim(id, 11, hostA, 7 * ONE, 25, Merkle.proof(t.leaves, 0));

        vm.prank(hostB);
        rewards.claim(id, 11, hostB, 3 * ONE, 10, Merkle.proof(t.leaves, 1));
        HostRewards.Campaign memory c = rewards.campaign(id);
        assertEq(c.claimed, 10 * ONE, "claimed");
        assertEq(rewards.totalLiability(), 90 * ONE, "liability down");
    }

    function test_claim_rejectsTamperedLeaf() public {
        uint256 id = _createFunded(100 * ONE, 0);
        Tree memory t = _twoHostTree(id, 11, 7 * ONE, 3 * ONE);
        vm.prank(operator);
        rewards.postRoot(id, 11, t.root, t.total, "ipfs://report");
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window
        bytes32[] memory p = Merkle.proof(t.leaves, 0);

        vm.expectRevert(HostRewards.InvalidProof.selector);
        rewards.claim(id, 11, hostA, 8 * ONE, 25, p); // amount
        vm.expectRevert(HostRewards.InvalidProof.selector);
        rewards.claim(id, 11, stranger, 7 * ONE, 25, p); // host
        vm.expectRevert(HostRewards.InvalidProof.selector);
        rewards.claim(id, 11, hostA, 7 * ONE, 26, p); // player count
        vm.expectRevert(abi.encodeWithSelector(HostRewards.NoRoot.selector, id, 12));
        rewards.claim(id, 12, hostA, 7 * ONE, 25, p); // matchweek without a root
        p[0] = keccak256("junk");
        vm.expectRevert(HostRewards.InvalidProof.selector);
        rewards.claim(id, 11, hostA, 7 * ONE, 25, p); // proof
    }

    function test_claim_rootFromOtherCampaignRejected() public {
        uint256 id1 = _createFunded(100 * ONE, 0);
        uint256 id2 = _createFunded(100 * ONE, 0);
        Tree memory t = _twoHostTree(id1, 11, 7 * ONE, 3 * ONE);
        vm.startPrank(operator);
        rewards.postRoot(id1, 11, t.root, t.total, "ipfs://r");
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window
        rewards.postRoot(id2, 11, t.root, t.total, "ipfs://r"); // same root reused on purpose
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window
        // campaign id is inside the leaf, so campaign 1's leaf does not verify for campaign 2
        vm.expectRevert(HostRewards.InvalidProof.selector);
        rewards.claim(id2, 11, hostA, 7 * ONE, 25, Merkle.proof(t.leaves, 0));
    }

    function test_claim_cannotExceedMatchweekAllocation() public {
        uint256 id = _createFunded(100 * ONE, 0);
        Tree memory t = _twoHostTree(id, 11, 7 * ONE, 3 * ONE);
        // operator posts a total lower than the leaves add up to (a bug or a bad key)
        vm.prank(operator);
        rewards.postRoot(id, 11, t.root, 8 * ONE, "ipfs://r");
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window
        rewards.claim(id, 11, hostA, 7 * ONE, 25, Merkle.proof(t.leaves, 0));
        vm.expectRevert(HostRewards.OverBudget.selector);
        rewards.claim(id, 11, hostB, 3 * ONE, 10, Merkle.proof(t.leaves, 1));
    }

    function test_claim_pausedReverts() public {
        uint256 id = _createFunded(100 * ONE, 0);
        Tree memory t = _twoHostTree(id, 11, 7 * ONE, 3 * ONE);
        vm.prank(operator);
        rewards.postRoot(id, 11, t.root, t.total, "ipfs://r");
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window
        vm.prank(pauser);
        rewards.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        rewards.claim(id, 11, hostA, 7 * ONE, 25, Merkle.proof(t.leaves, 0));
    }

    function test_claim_afterClaimPeriodReverts() public {
        uint256 id = _createFunded(100 * ONE, 0);
        Tree memory t = _twoHostTree(id, 11, 7 * ONE, 3 * ONE);
        vm.prank(operator);
        rewards.postRoot(id, 11, t.root, t.total, "ipfs://r");
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window
        vm.warp(uint256(expiry) + rewards.CLAIM_PERIOD());
        vm.expectRevert(abi.encodeWithSelector(HostRewards.ClaimPeriodOver.selector, id));
        rewards.claim(id, 11, hostA, 7 * ONE, 25, Merkle.proof(t.leaves, 0));
    }

    function test_claim_reentrancyBlocked() public {
        ReentrantERC20 evil = new ReentrantERC20();
        HostRewards r2 = new HostRewards(
            admin, operator, pauser, IERC20(address(evil)), mw, treasury, CAP_CAMPAIGN, CAP_TOTAL
        );
        evil.mint(sponsor, 1_000 * ONE);
        vm.prank(operator);
        uint256 id = r2.createCampaign(_terms(100 * ONE, 0));
        vm.startPrank(sponsor);
        evil.approve(address(r2), 100 * ONE);
        r2.fund(id);
        vm.stopPrank();

        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = r2.leafHash(id, 11, hostA, 7 * ONE, 25);
        leaves[1] = r2.leafHash(id, 11, hostB, 3 * ONE, 10);
        vm.prank(operator);
        r2.postRoot(id, 11, Merkle.root(leaves), 10 * ONE, "ipfs://r");
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window

        bytes32[] memory proofB = Merkle.proof(leaves, 1);
        evil.arm(
            IClaimTarget(address(r2)),
            abi.encodeCall(IClaimTarget.claim, (id, uint32(11), hostB, uint128(3 * ONE), uint32(10), proofB))
        );
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        r2.claim(id, 11, hostA, 7 * ONE, 25, Merkle.proof(leaves, 0));
    }

    // ------------------------------------------------------------ refund

    function test_refund_beforeExpiryReverts() public {
        uint256 id = _createFunded(100 * ONE, 0);
        vm.expectRevert(abi.encodeWithSelector(HostRewards.NotExpired.selector, id));
        rewards.refund(id);
    }

    function test_refund_twoStages() public {
        uint256 id = _createFunded(100 * ONE, 0);
        Tree memory t = _twoHostTree(id, 11, 7 * ONE, 3 * ONE);
        vm.prank(operator);
        rewards.postRoot(id, 11, t.root, t.total, "ipfs://r");
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window
        rewards.claim(id, 11, hostA, 7 * ONE, 25, Merkle.proof(t.leaves, 0));

        uint256 sponsorBefore = qusdc.balanceOf(sponsor);

        // stage 1: at expiry the unallocated 90 goes back; hostB's 3 stays reserved
        vm.warp(expiry);
        vm.prank(stranger);
        uint128 first = rewards.refund(id);
        assertEq(first, 90 * ONE, "unallocated refunded");
        assertEq(qusdc.balanceOf(sponsor) - sponsorBefore, 90 * ONE, "to sponsor");
        vm.expectRevert(HostRewards.NothingToRefund.selector);
        rewards.refund(id);

        // hostB can still claim during the claim period
        rewards.claim(id, 11, hostB, 3 * ONE, 10, Merkle.proof(t.leaves, 1));

        // stage 2: after the claim period the campaign closes with nothing left
        vm.warp(uint256(expiry) + rewards.CLAIM_PERIOD());
        uint128 second = rewards.refund(id);
        assertEq(second, 0, "nothing left");
        assertEq(uint256(rewards.campaign(id).status), uint256(HostRewards.CampaignStatus.Closed), "closed");
        assertEq(qusdc.balanceOf(address(rewards)), 0, "empty");
        assertEq(rewards.totalLiability(), 0, "no liability");
    }

    function test_refund_sweepsUnclaimedAfterClaimPeriod() public {
        uint256 id = _createFunded(100 * ONE, 0);
        Tree memory t = _twoHostTree(id, 11, 7 * ONE, 3 * ONE);
        vm.prank(operator);
        rewards.postRoot(id, 11, t.root, t.total, "ipfs://r");
        vm.warp(block.timestamp + 1 days); // CLAIM_DELAY review window
        vm.warp(uint256(expiry) + rewards.CLAIM_PERIOD());
        assertEq(rewards.refund(id), 100 * ONE, "everything unclaimed returns");
        vm.expectRevert(
            abi.encodeWithSelector(HostRewards.WrongStatus.selector, id, HostRewards.CampaignStatus.Closed)
        );
        rewards.refund(id);
    }

    function test_refund_worksWhilePaused() public {
        uint256 id = _createFunded(100 * ONE, 0);
        vm.prank(pauser);
        rewards.pause();
        vm.warp(expiry);
        assertEq(rewards.refund(id), 100 * ONE, "pauser cannot trap sponsor funds");
    }

    // ------------------------------------------------------------ audit fixes

    /// @dev Informational: a posted root sits for CLAIM_DELAY before anyone can claim against it.
    function test_claim_waitsForReviewDelay() public {
        uint256 id = _createFunded(100 * ONE, 0);
        Tree memory t = _twoHostTree(id, 11, 7 * ONE, 3 * ONE);
        vm.prank(operator);
        rewards.postRoot(id, 11, t.root, t.total, "ipfs://r");
        vm.warp(block.timestamp + rewards.CLAIM_DELAY() - 1);
        vm.expectRevert(abi.encodeWithSelector(HostRewards.ClaimNotOpen.selector, id, 11));
        rewards.claim(id, 11, hostA, 7 * ONE, 25, Merkle.proof(t.leaves, 0));
        vm.warp(block.timestamp + 1);
        rewards.claim(id, 11, hostA, 7 * ONE, 25, Merkle.proof(t.leaves, 0));
        assertEq(qusdc.balanceOf(hostA), 7 * ONE, "paid once open");
    }

    /// @dev Audit M-1: a pause cannot run out a host's claim period and hand the money back.
    function test_pause_extendsClaimDeadline() public {
        uint256 id = _createFunded(100 * ONE, 0);
        Tree memory t = _twoHostTree(id, 11, 7 * ONE, 3 * ONE);
        vm.prank(operator);
        rewards.postRoot(id, 11, t.root, t.total, "ipfs://r");
        uint256 deadline = rewards.claimDeadline(id);
        assertEq(deadline, uint256(expiry) + rewards.CLAIM_PERIOD(), "base deadline");

        // pause just before expiry and keep it paused past the original deadline
        uint256 pausedFrom = uint256(expiry) - 1 hours;
        vm.warp(pausedFrom);
        vm.prank(pauser);
        rewards.pause();
        vm.warp(deadline + 10 days);
        uint256 pausedFor = block.timestamp - pausedFrom;
        assertEq(rewards.claimDeadline(id), deadline + pausedFor, "deadline grows by the whole pause");

        // a refund now may only return unallocated money: the 10 QUSDC for hosts stays put
        assertEq(rewards.refund(id), 90 * ONE, "only unallocated refunded");
        assertEq(
            uint256(rewards.campaign(id).status), uint256(HostRewards.CampaignStatus.Active), "still open"
        );

        vm.prank(admin);
        rewards.unpause();
        uint256 extended = rewards.claimDeadline(id);
        assertEq(extended, deadline + pausedFor, "extension kept after unpause");
        rewards.claim(id, 11, hostA, 7 * ONE, 25, Merkle.proof(t.leaves, 0));
        assertEq(qusdc.balanceOf(hostA), 7 * ONE, "host still paid after the pause");

        vm.warp(extended);
        vm.expectRevert(abi.encodeWithSelector(HostRewards.ClaimPeriodOver.selector, id));
        rewards.claim(id, 11, hostB, 3 * ONE, 10, Merkle.proof(t.leaves, 1));
        assertEq(rewards.refund(id), 3 * ONE, "unclaimed returns at the extended deadline");
    }

    /// @dev A campaign funded after a pause only gets pause time that happens after its funding.
    function test_pause_beforeFundingDoesNotExtend() public {
        vm.prank(pauser);
        rewards.pause();
        vm.warp(block.timestamp + 5 days);
        vm.prank(admin);
        rewards.unpause();
        uint256 id = _createFunded(100 * ONE, 0);
        assertEq(
            rewards.claimDeadline(id), uint256(expiry) + rewards.CLAIM_PERIOD(), "no inherited extension"
        );
    }

    /// @dev Audit L-3: a wrong root can be corrected before anything is claimed from it.
    function test_replaceRoot_beforeClaims() public {
        uint256 id = _createFunded(100 * ONE, 0);
        Tree memory bad = _twoHostTree(id, 11, 70 * ONE, 3 * ONE);
        Tree memory good = _twoHostTree(id, 11, 7 * ONE, 3 * ONE);
        vm.prank(operator);
        rewards.postRoot(id, 11, bad.root, bad.total, "ipfs://bad");
        assertEq(rewards.campaign(id).allocated, 73 * ONE, "bad allocation");

        vm.warp(block.timestamp + 12 hours);
        vm.expectEmit(true, true, true, true, address(rewards));
        emit HostRewards.RootReplaced(id, 11, bad.root, good.root, good.total, "ipfs://good");
        vm.prank(operator);
        rewards.replaceRoot(id, 11, good.root, good.total, "ipfs://good");
        assertEq(rewards.campaign(id).allocated, 10 * ONE, "allocation corrected");
        assertEq(rewards.allocatedFor(id, 11), 10 * ONE, "matchweek allocation corrected");

        // the review delay restarts
        vm.warp(block.timestamp + 12 hours);
        vm.expectRevert(abi.encodeWithSelector(HostRewards.ClaimNotOpen.selector, id, 11));
        rewards.claim(id, 11, hostA, 7 * ONE, 25, Merkle.proof(good.leaves, 0));
        vm.warp(block.timestamp + 12 hours);

        // the old leaf is dead, the new one pays
        vm.expectRevert(HostRewards.InvalidProof.selector);
        rewards.claim(id, 11, hostA, 70 * ONE, 25, Merkle.proof(bad.leaves, 0));
        rewards.claim(id, 11, hostA, 7 * ONE, 25, Merkle.proof(good.leaves, 0));
        assertEq(qusdc.balanceOf(hostA), 7 * ONE, "paid from the corrected root");
    }

    function test_replaceRoot_blockedAfterAClaim() public {
        uint256 id = _createFunded(100 * ONE, 0);
        Tree memory t = _twoHostTree(id, 11, 7 * ONE, 3 * ONE);
        Tree memory other = _twoHostTree(id, 11, 6 * ONE, 4 * ONE);
        vm.prank(operator);
        rewards.postRoot(id, 11, t.root, t.total, "ipfs://r");
        vm.warp(block.timestamp + 1 days);
        rewards.claim(id, 11, hostA, 7 * ONE, 25, Merkle.proof(t.leaves, 0));
        vm.expectRevert(abi.encodeWithSelector(HostRewards.AlreadyClaimedFrom.selector, id, 11));
        vm.prank(operator);
        rewards.replaceRoot(id, 11, other.root, other.total, "ipfs://other");
    }

    /// @dev Audit S3 / PoC: a bad root posted shortly before expiry stays fixable during its review delay.
    function test_badRootNearExpiry_canBeReplacedOrVoided() public {
        uint256 id = _createFunded(100 * ONE, 0);
        Tree memory bad = _twoHostTree(id, 11, 90 * ONE, 1 * ONE);
        Tree memory good = _twoHostTree(id, 11, 7 * ONE, 3 * ONE);
        vm.warp(uint256(expiry) - 1 hours);
        vm.prank(operator);
        rewards.postRoot(id, 11, bad.root, bad.total, "ipfs://bad");
        vm.warp(uint256(expiry) + 1 hours); // expired, still inside the review delay

        // operator can replace it after expiry
        vm.prank(operator);
        rewards.replaceRoot(id, 11, good.root, good.total, "ipfs://good");
        assertEq(rewards.campaign(id).allocated, 10 * ONE, "allocation corrected after expiry");

        // the admin can void it outright; the allocation becomes refundable
        vm.prank(admin);
        rewards.voidRoot(id, 11);
        assertEq(rewards.rootOf(id, 11), bytes32(0), "root removed");
        assertEq(rewards.campaign(id).allocated, 0, "allocation released");
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(abi.encodeWithSelector(HostRewards.NoRoot.selector, id, 11));
        rewards.claim(id, 11, hostA, 90 * ONE, 25, Merkle.proof(bad.leaves, 0));
        assertEq(rewards.refund(id), 100 * ONE, "whole budget back to the sponsor");
    }

    function test_voidRoot_guards() public {
        uint256 id = _createFunded(100 * ONE, 0);
        Tree memory t = _twoHostTree(id, 11, 7 * ONE, 3 * ONE);
        vm.expectRevert(abi.encodeWithSelector(HostRewards.NoRoot.selector, id, 11));
        vm.prank(admin);
        rewards.voidRoot(id, 11);
        vm.prank(operator);
        rewards.postRoot(id, 11, t.root, t.total, "ipfs://r");
        // only the admin
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                operator,
                rewards.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(operator);
        rewards.voidRoot(id, 11);
        // not once someone has claimed
        vm.warp(block.timestamp + 1 days);
        rewards.claim(id, 11, hostA, 7 * ONE, 25, Merkle.proof(t.leaves, 0));
        vm.expectRevert(abi.encodeWithSelector(HostRewards.AlreadyClaimedFrom.selector, id, 11));
        vm.prank(admin);
        rewards.voidRoot(id, 11);
        // and not after the claim deadline
        vm.warp(rewards.claimDeadline(id));
        vm.expectRevert(abi.encodeWithSelector(HostRewards.ClaimPeriodOver.selector, id));
        vm.prank(operator);
        rewards.replaceRoot(id, 11, keccak256("x"), ONE, "ipfs://x");
    }

    /// @dev Audit L-1: a leaked pauser (operator) key cannot undo an emergency pause.
    function test_unpause_onlyAdmin() public {
        vm.prank(pauser);
        rewards.pause();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, pauser, rewards.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(pauser);
        rewards.unpause();
        vm.prank(admin);
        rewards.unpause();
        assertFalse(rewards.paused(), "admin unpaused");
    }

    function test_replaceRoot_guards() public {
        uint256 id = _createFunded(100 * ONE, 0);
        Tree memory t = _twoHostTree(id, 11, 7 * ONE, 3 * ONE);
        Tree memory other = _twoHostTree(id, 11, 6 * ONE, 4 * ONE);
        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(HostRewards.NoRoot.selector, id, 11));
        rewards.replaceRoot(id, 11, other.root, other.total, "ipfs://other");
        rewards.postRoot(id, 11, t.root, t.total, "ipfs://r");
        vm.expectRevert(HostRewards.InvalidParams.selector);
        rewards.replaceRoot(id, 11, t.root, t.total, "ipfs://same");
        vm.expectRevert(HostRewards.OverBudget.selector);
        rewards.replaceRoot(id, 11, other.root, 101 * ONE, "ipfs://other");
        vm.stopPrank();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, rewards.OPERATOR_ROLE()
            )
        );
        vm.prank(stranger);
        rewards.replaceRoot(id, 11, other.root, other.total, "ipfs://other");
    }

    /// @dev Final review H-1: after the unallocated budget is refunded, a correction may not raise
    ///      the allocation above what is left, or it would pay out of another campaign's escrow.
    function test_replaceRoot_afterRefund_cannotExceedRemainingBudget() public {
        uint256 a = _createFunded(500 * ONE, 0);
        uint256 b = _createFunded(500 * ONE, 0);
        Tree memory t1 = _twoHostTree(a, 11, 50 * ONE, 50 * ONE);
        vm.prank(operator);
        rewards.postRoot(a, 11, t1.root, t1.total, "ipfs://1");
        vm.warp(expiry);
        rewards.refund(a); // the 400 unallocated goes back to the sponsor

        Tree memory up = _twoHostTree(a, 11, 150 * ONE, 150 * ONE);
        vm.expectRevert(HostRewards.OverBudget.selector);
        vm.prank(operator);
        rewards.replaceRoot(a, 11, up.root, up.total, "ipfs://2");

        // A correction within the remaining 100 still works, and b's escrow stays whole.
        Tree memory fix = _twoHostTree(a, 11, 60 * ONE, 40 * ONE);
        vm.prank(operator);
        rewards.replaceRoot(a, 11, fix.root, fix.total, "ipfs://3");
        assertEq(uint256(rewards.totalLiability()), uint256(600 * ONE), "liability");
        assertGe(qusdc.balanceOf(address(rewards)), uint256(rewards.totalLiability()), "solvent");
        assertEq(uint256(rewards.campaign(b).budget), uint256(500 * ONE), "b intact");
    }

    /// @dev Audit L-4: the sponsor can redirect refunds, nobody else can.
    function test_setRefundRecipient() public {
        uint256 id = _createFunded(100 * ONE, 0);
        address safe = makeAddr("sponsorSafe");
        vm.expectRevert(HostRewards.NotSponsor.selector);
        vm.prank(stranger);
        rewards.setRefundRecipient(id, stranger);
        vm.expectRevert(HostRewards.NotSponsor.selector);
        vm.prank(operator);
        rewards.setRefundRecipient(id, operator);
        vm.expectRevert(HostRewards.InvalidParams.selector);
        vm.prank(sponsor);
        rewards.setRefundRecipient(id, address(0));

        vm.expectEmit(true, true, true, true, address(rewards));
        emit HostRewards.RefundRecipientSet(id, safe);
        vm.prank(sponsor);
        rewards.setRefundRecipient(id, safe);

        uint256 sponsorBefore = qusdc.balanceOf(sponsor);
        vm.warp(expiry);
        vm.prank(stranger);
        rewards.refund(id);
        assertEq(qusdc.balanceOf(safe), 100 * ONE, "refund to the chosen recipient");
        assertEq(qusdc.balanceOf(sponsor), sponsorBefore, "not to the sponsor");
    }

    // ------------------------------------------------------------ admin

    function test_setCaps_onlyAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                operator,
                rewards.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(operator);
        rewards.setCaps(1_000 * ONE, 5_000 * ONE);

        vm.prank(admin);
        rewards.setCaps(1_000 * ONE, 5_000 * ONE);
        assertEq(rewards.maxCampaignBudget(), 1_000 * ONE, "raised");
    }

    function test_setTreasury_onlyAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                operator,
                rewards.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(operator);
        rewards.setTreasury(stranger);
        vm.prank(admin);
        rewards.setTreasury(stranger);
        assertEq(rewards.treasury(), stranger, "treasury");
    }

    function test_golden_leafHash() public view {
        // test/fixtures/golden-vectors.json -> hostRewardLeaf
        assertEq(
            rewards.leafHash(1, 11, 0x70997970C51812dc3A010C7d01b50e0d17dc79C8, 2_500_000, 25),
            0x7fe9820cce734a58dc4617c73ed67f4a053295972f019755c929f240f0bd288f,
            "leaf matches StandardMerkleTree encoding"
        );
    }
}
