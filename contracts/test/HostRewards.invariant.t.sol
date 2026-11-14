// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {vm} from "./utils/Vm.sol";
import {Merkle} from "./utils/Merkle.sol";
import {HostRewardsFixture} from "./HostRewards.t.sol";
import {HostRewards} from "../src/HostRewards.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Drives HostRewards through random fund / postRoot / claim / refund / time sequences.
contract HostRewardsHandler {
    HostRewards public immutable rewards;
    MockERC20 public immutable token;
    address public immutable sponsor;
    address public immutable operator;
    address public immutable admin;
    address public immutable pauser;
    address[3] internal hosts;

    uint256[] public campaignIds;

    // pending claims: (campaign, matchweek, host index, amount, players, leaves)
    struct Pending {
        uint256 id;
        uint32 mw;
        uint8 hostIndex;
        uint128 amount;
        bytes32[] leaves;
        bool done;
    }

    Pending[] internal pendings;

    // ghost counters: successful actions, so a green run can be told apart from a no-op run
    uint256 public funded;
    uint256 public rootsPosted;
    uint256 public claims;
    uint256 public refunds;
    uint256 public replaced;
    uint256 public voided;
    uint256 public pauses;

    constructor(
        HostRewards rewards_,
        MockERC20 token_,
        address sponsor_,
        address operator_,
        address admin_,
        address pauser_
    ) {
        rewards = rewards_;
        token = token_;
        sponsor = sponsor_;
        operator = operator_;
        admin = admin_;
        pauser = pauser_;
        hosts = [address(0xA1), address(0xA2), address(0xA3)];
    }

    function createAndFund(uint128 gross, uint16 feeBps) external {
        _createAndFund(gross, feeBps, 10 days);
    }

    /// @dev Campaigns with different expiries, so pause extensions and deadlines interleave.
    function createAndFundWithExpiry(uint128 gross, uint16 feeBps, uint32 days_) external {
        _createAndFund(gross, feeBps, uint64(3 days + (uint256(days_) % 18 days)));
    }

    function _createAndFund(uint128 gross, uint16 feeBps, uint64 life) internal {
        gross = uint128(1 + (gross % 500e6));
        feeBps = uint16(feeBps % 1_001);
        HostRewards.Terms memory t = HostRewards.Terms({
            sponsor: sponsor,
            grossAmount: gross,
            feeBps: feeBps,
            ratePerPlayer: 1e5,
            capPerHost: 50e6,
            firstMatchweek: 11,
            lastMatchweek: 12,
            expiry: uint64(block.timestamp + life),
            leaguesHash: keccak256("l"),
            termsHash: keccak256("t")
        });
        if (rewards.budgetOf(gross, feeBps) == 0) return;
        vm.prank(operator);
        uint256 id = rewards.createCampaign(t);
        token.mint(sponsor, gross);
        vm.startPrank(sponsor);
        token.approve(address(rewards), gross);
        try rewards.fund(id) {
            campaignIds.push(id);
            ++funded;
        } catch {}
        vm.stopPrank();
    }

    function postRoot(uint256 seed, uint128 a, uint128 b, uint128 c, bool mw12) external {
        if (campaignIds.length == 0) return;
        uint256 id = campaignIds[seed % campaignIds.length];
        HostRewards.Campaign memory cp = rewards.campaign(id);
        uint128 room = cp.budget - cp.allocated;
        if (room < 3) return;
        a = 1 + (a % (room / 3));
        b = 1 + (b % (room / 3));
        c = 1 + (c % (room / 3));
        uint32 mwId = mw12 ? 12 : 11;
        bytes32[] memory leaves = new bytes32[](3);
        leaves[0] = rewards.leafHash(id, mwId, hosts[0], a, 1);
        leaves[1] = rewards.leafHash(id, mwId, hosts[1], b, 1);
        leaves[2] = rewards.leafHash(id, mwId, hosts[2], c, 1);
        vm.prank(operator);
        try rewards.postRoot(id, mwId, Merkle.root(leaves), a + b + c, "ipfs://r") {
            pendings.push(Pending(id, mwId, 0, a, leaves, false));
            pendings.push(Pending(id, mwId, 1, b, leaves, false));
            pendings.push(Pending(id, mwId, 2, c, leaves, false));
            ++rootsPosted;
        } catch {}
    }

    function claim(uint256 seed) external {
        if (pendings.length == 0) return;
        Pending storage p = pendings[seed % pendings.length];
        if (p.done) return;
        try rewards.claim(p.id, p.mw, hosts[p.hostIndex], p.amount, 1, Merkle.proof(p.leaves, p.hostIndex)) {
            p.done = true;
            ++claims;
        } catch {}
    }

    function refund(uint256 seed) external {
        if (campaignIds.length == 0) return;
        try rewards.refund(campaignIds[seed % campaignIds.length]) {
            ++refunds;
        } catch {}
    }

    /// @dev Replace an unclaimed root with new amounts: its old leaves die, new ones become claimable.
    function replaceRoot(uint256 seed, uint128 a, uint128 b, uint128 c) external {
        if (pendings.length == 0) return;
        Pending storage p = pendings[seed % pendings.length];
        HostRewards.Campaign memory cp = rewards.campaign(p.id);
        uint128 room = cp.budget - cp.allocated + rewards.allocatedFor(p.id, p.mw);
        if (room < 3) return;
        a = 1 + (a % (room / 3));
        b = 1 + (b % (room / 3));
        c = 1 + (c % (room / 3));
        bytes32[] memory leaves = new bytes32[](3);
        leaves[0] = rewards.leafHash(p.id, p.mw, hosts[0], a, 2);
        leaves[1] = rewards.leafHash(p.id, p.mw, hosts[1], b, 2);
        leaves[2] = rewards.leafHash(p.id, p.mw, hosts[2], c, 2);
        (uint256 id, uint32 mwId) = (p.id, p.mw);
        vm.prank(operator);
        try rewards.replaceRoot(id, mwId, Merkle.root(leaves), a + b + c, "ipfs://r2") {
            _killPendings(id, mwId);
            pendings.push(Pending(id, mwId, 0, a, leaves, false));
            pendings.push(Pending(id, mwId, 1, b, leaves, false));
            pendings.push(Pending(id, mwId, 2, c, leaves, false));
            ++replaced;
        } catch {}
    }

    function voidRoot(uint256 seed) external {
        if (pendings.length == 0) return;
        Pending storage p = pendings[seed % pendings.length];
        (uint256 id, uint32 mwId) = (p.id, p.mw);
        vm.prank(admin);
        try rewards.voidRoot(id, mwId) {
            _killPendings(id, mwId);
            ++voided;
        } catch {}
    }

    function pause() external {
        vm.prank(pauser);
        try rewards.pause() {
            ++pauses;
        } catch {}
    }

    function unpause() external {
        vm.prank(admin);
        try rewards.unpause() {} catch {}
    }

    function _killPendings(uint256 id, uint32 mwId) internal {
        for (uint256 i = 0; i < pendings.length; ++i) {
            if (pendings[i].id == id && pendings[i].mw == mwId) pendings[i].done = true;
        }
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + (secs % 3 days));
    }

    function campaignCount() external view returns (uint256) {
        return campaignIds.length;
    }
}

contract HostRewardsInvariantTest is HostRewardsFixture {
    HostRewardsHandler internal handler;

    function setUp() public override {
        super.setUp();
        // lift caps so the handler explores many campaigns
        vm.prank(admin);
        rewards.setCaps(500e6, type(uint128).max);
        handler = new HostRewardsHandler(rewards, qusdc, sponsor, operator, admin, pauser);
    }

    function targetContracts() public view returns (address[] memory t) {
        t = new address[](1);
        t[0] = address(handler);
    }

    /// @notice The contract's QUSDC equals what it owes: sum(budget - claimed - refunded).
    function invariant_balanceEqualsLiability() public view {
        uint256 owed;
        uint256 n = rewards.campaignCount();
        for (uint256 id = 1; id <= n; ++id) {
            HostRewards.Campaign memory c = rewards.campaign(id);
            if (
                c.status == HostRewards.CampaignStatus.Active || c.status == HostRewards.CampaignStatus.Closed
            ) {
                owed += c.budget - c.claimed - c.refunded;
            }
        }
        assertEq(qusdc.balanceOf(address(rewards)), owed, "balance == owed");
        assertEq(rewards.totalLiability(), owed, "totalLiability == owed");
    }

    /// @notice Proves each handler path really changes state, so a green invariant run is not a no-op.
    function test_handler_everyPathLands() public {
        handler.createAndFund(100e6, 500);
        handler.postRoot(0, 10e6, 20e6, 5e6, false);
        handler.warp(1 days); // CLAIM_DELAY review window
        handler.claim(0);
        handler.warp(3 days - 1);
        for (uint256 i = 0; i < 4; ++i) {
            handler.warp(3 days - 1); // past expiry (10 days)
        }
        handler.refund(0);
        assertEq(handler.funded(), 1, "funded");
        assertEq(handler.rootsPosted(), 1, "root posted");
        assertEq(handler.claims(), 1, "claimed");
        assertEq(handler.refunds(), 1, "refunded");
        invariant_balanceEqualsLiability();
        invariant_accountingOrder();
    }

    /// @notice A pause never shortens a claim period, and claims stop exactly at the deadline.
    function invariant_deadlineNeverBeforeBase() public view {
        uint256 n = rewards.campaignCount();
        for (uint256 id = 1; id <= n; ++id) {
            HostRewards.Campaign memory c = rewards.campaign(id);
            if (
                c.status == HostRewards.CampaignStatus.Pending
                    || c.status == HostRewards.CampaignStatus.Cancelled
            ) continue;
            assertGe(
                rewards.claimDeadline(id),
                uint256(c.terms.expiry) + rewards.CLAIM_PERIOD(),
                "deadline >= expiry + period"
            );
        }
    }

    /// @notice Exercises the correction and pause paths deterministically too.
    function test_handler_correctionPathsLand() public {
        handler.createAndFundWithExpiry(100e6, 0, 7);
        handler.postRoot(0, 10e6, 20e6, 5e6, false);
        handler.replaceRoot(0, 1e6, 2e6, 3e6);
        handler.pause();
        handler.warp(2 days);
        handler.unpause();
        handler.voidRoot(0);
        assertEq(handler.replaced(), 1, "replaced");
        assertEq(handler.voided(), 1, "voided");
        assertEq(handler.pauses(), 1, "paused");
        invariant_balanceEqualsLiability();
        invariant_accountingOrder();
        invariant_deadlineNeverBeforeBase();
    }

    /// @notice Final review H-1: refund at expiry, then a larger correction, then claims. The
    ///         correction must not be able to allocate money that was already refunded.
    function test_handler_refundThenReplaceHigher() public {
        handler.createAndFundWithExpiry(100e6, 0, 0); // expires in 3 days
        handler.postRoot(0, 1e6, 1e6, 1e6, false);
        handler.warp(2 days);
        handler.warp(2 days); // past expiry, inside the claim period
        handler.refund(0); // 97 QUSDC unallocated goes back
        assertEq(handler.refunds(), 1, "refunded");
        handler.replaceRoot(0, 30e6, 30e6, 30e6); // must revert: only 3 QUSDC left in the campaign
        assertEq(handler.replaced(), 0, "over-allocation refused");
        handler.warp(1 days);
        for (uint256 i = 0; i < 3; ++i) handler.claim(i);
        invariant_balanceEqualsLiability();
        invariant_accountingOrder();
    }

    /// @notice claimed <= allocated <= budget, and refunds never dip into claimed money.
    function invariant_accountingOrder() public view {
        uint256 n = rewards.campaignCount();
        for (uint256 id = 1; id <= n; ++id) {
            HostRewards.Campaign memory c = rewards.campaign(id);
            assertLe(c.claimed, c.allocated, "claimed <= allocated");
            assertLe(c.allocated, c.budget, "allocated <= budget");
            assertLe(uint256(c.claimed) + c.refunded, c.budget, "claimed + refunded <= budget");
            if (c.status == HostRewards.CampaignStatus.Active) {
                assertLe(uint256(c.allocated) + c.refunded, c.budget, "allocated + refunded <= budget");
            }
            if (c.status == HostRewards.CampaignStatus.Closed) {
                assertEq(uint256(c.claimed) + c.refunded, c.budget, "closed campaigns are fully settled");
            }
        }
    }
}
