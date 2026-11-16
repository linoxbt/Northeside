// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {vm} from "./utils/Vm.sol";
import {Base} from "./utils/Base.sol";
import {Merkle} from "./utils/Merkle.sol";
import {NorthesideBadges} from "../src/NorthesideBadges.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

contract NorthesideBadgesTest is Base {
    NorthesideBadges internal badges;
    address internal admin = makeAddr("admin");
    address internal operator = makeAddr("operator");
    address internal pauser = makeAddr("pauser");
    address internal ada = makeAddr("ada");
    address internal bo = makeAddr("bo");
    address internal eve = makeAddr("eve");

    bytes32[] internal leaves;

    uint8 internal constant FIRST_SEAL = 1;
    uint8 internal constant SNIPER = 5;

    function setUp() public {
        badges = new NorthesideBadges(admin, operator, pauser, "https://northeside.example/api/v1/badges/");
        leaves.push(badges.leafHash(ada, FIRST_SEAL));
        leaves.push(badges.leafHash(ada, SNIPER));
        leaves.push(badges.leafHash(bo, FIRST_SEAL));
        vm.prank(operator);
        badges.postRoot(Merkle.root(leaves));
    }

    function _claim(address who, uint8 badgeId, uint256 leafIndex) internal {
        bytes32[] memory p = Merkle.proof(leaves, leafIndex);
        vm.prank(who);
        badges.claim(1, badgeId, p);
    }

    function test_playerMintsTheirOwnBadge() public {
        vm.expectEmit(true, true, true, true, address(badges));
        emit NorthesideBadges.BadgeClaimed(ada, SNIPER, 1);
        _claim(ada, SNIPER, 1);
        assertEq(badges.balanceOf(ada, SNIPER), 1, "ada holds Sniper");
        assertTrue(badges.claimed(ada, SNIPER), "marked claimed");
        _claim(ada, FIRST_SEAL, 0);
        _claim(bo, FIRST_SEAL, 2);
        assertEq(badges.balanceOf(bo, FIRST_SEAL), 1, "bo holds First seal");
        assertEq(badges.balanceOf(bo, SNIPER), 0, "bo has no Sniper");
    }

    function test_cannotClaimTwiceEvenAfterBurning() public {
        _claim(ada, SNIPER, 1);
        bytes32[] memory p = Merkle.proof(leaves, 1);
        vm.prank(ada);
        vm.expectRevert(abi.encodeWithSelector(NorthesideBadges.AlreadyClaimed.selector, ada, SNIPER));
        badges.claim(1, SNIPER, p);
        vm.prank(ada);
        badges.burn(SNIPER);
        assertEq(badges.balanceOf(ada, SNIPER), 0, "burned");
        vm.prank(ada);
        vm.expectRevert(abi.encodeWithSelector(NorthesideBadges.AlreadyClaimed.selector, ada, SNIPER));
        badges.claim(1, SNIPER, p);
    }

    function test_proofIsBoundToTheClaimingWallet() public {
        bytes32[] memory p = Merkle.proof(leaves, 1); // Ada's Sniper
        vm.prank(eve);
        vm.expectRevert(NorthesideBadges.InvalidProof.selector);
        badges.claim(1, SNIPER, p);
        vm.prank(bo);
        vm.expectRevert(NorthesideBadges.InvalidProof.selector);
        badges.claim(1, SNIPER, Merkle.proof(leaves, 2)); // Bo's First seal proof for Sniper
    }

    function test_badgesAreSoulbound() public {
        _claim(ada, SNIPER, 1);
        vm.prank(ada);
        vm.expectRevert(NorthesideBadges.Soulbound.selector);
        badges.safeTransferFrom(ada, bo, SNIPER, 1, "");
        uint256[] memory ids = new uint256[](1);
        ids[0] = SNIPER;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1;
        vm.prank(ada);
        vm.expectRevert(NorthesideBadges.Soulbound.selector);
        badges.safeBatchTransferFrom(ada, bo, ids, amounts, "");
        vm.prank(ada);
        vm.expectRevert(NorthesideBadges.Soulbound.selector);
        badges.setApprovalForAll(bo, true);
        assertFalse(badges.isApprovedForAll(ada, bo), "no approvals");
    }

    function test_onlyOperatorPostsRoots_andZeroRootRejected() public {
        bytes32 role = badges.OPERATOR_ROLE();
        vm.prank(eve);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, eve, role));
        badges.postRoot(keccak256("x"));
        vm.prank(operator);
        vm.expectRevert(NorthesideBadges.ZeroRoot.selector);
        badges.postRoot(bytes32(0));
        vm.prank(operator);
        assertEq(badges.postRoot(keccak256("r2")), 2, "second round");
        assertEq(badges.rounds(), 2, "two rounds");
    }

    function test_revokedAndUnknownRoundsCannotBeClaimed() public {
        bytes32[] memory p = Merkle.proof(leaves, 1);
        vm.prank(ada);
        vm.expectRevert(abi.encodeWithSelector(NorthesideBadges.UnknownRound.selector, 7));
        badges.claim(7, SNIPER, p);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, operator, bytes32(0)));
        badges.revokeRoot(1);
        vm.prank(admin);
        badges.revokeRoot(1);
        vm.prank(ada);
        vm.expectRevert(abi.encodeWithSelector(NorthesideBadges.Revoked.selector, 1));
        badges.claim(1, SNIPER, p);
        vm.prank(ada);
        vm.expectRevert(abi.encodeWithSelector(NorthesideBadges.BadBadge.selector, 0));
        badges.claim(1, 0, p);
    }

    function test_pauseStopsClaims_onlyAdminUnpauses() public {
        vm.prank(pauser);
        badges.pause();
        bytes32[] memory p = Merkle.proof(leaves, 1);
        vm.prank(ada);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        badges.claim(1, SNIPER, p);
        vm.prank(pauser);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, pauser, bytes32(0)));
        badges.unpause();
        vm.prank(admin);
        badges.unpause();
        _claim(ada, SNIPER, 1);
    }

    function test_metadataUri_andInterfaces() public {
        assertTrue(keccak256(bytes(badges.uri(5))) == keccak256("https://northeside.example/api/v1/badges/5"), "uri");
        vm.expectRevert(abi.encodeWithSelector(NorthesideBadges.BadBadge.selector, 256));
        badges.uri(256);
        vm.prank(admin);
        badges.setBaseURI("https://new.example/b/");
        assertTrue(keccak256(bytes(badges.uri(12))) == keccak256("https://new.example/b/12"), "new base");
        assertTrue(badges.supportsInterface(type(IERC1155).interfaceId), "erc1155");
        assertTrue(badges.supportsInterface(type(IAccessControl).interfaceId), "access control");
    }

    function testFuzz_unlistedBadgeOrWalletFails(address who, uint8 badgeId) public {
        vm.assume(badgeId != 0);
        bool listed = (who == ada && (badgeId == FIRST_SEAL || badgeId == SNIPER)) || (who == bo && badgeId == FIRST_SEAL);
        vm.assume(!listed && who != address(0));
        for (uint256 i = 0; i < leaves.length; ++i) {
            bytes32[] memory p = Merkle.proof(leaves, i);
            vm.prank(who);
            vm.expectRevert(NorthesideBadges.InvalidProof.selector);
            badges.claim(1, badgeId, p);
        }
    }
}
