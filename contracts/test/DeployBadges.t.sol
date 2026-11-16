// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {vm} from "./utils/Vm.sol";
import {Base} from "./utils/Base.sol";
import {DeployBadges} from "../script/DeployBadges.s.sol";
import {NorthesideBadges} from "../src/NorthesideBadges.sol";

contract DeployBadgesTest is Base {
    uint256 internal constant DEPLOYER_KEY = 0xB0B;
    DeployBadges internal script;

    function setUp() public {
        script = new DeployBadges();
    }

    function _config() internal returns (DeployBadges.Config memory c) {
        c.admin = makeAddr("admin");
        c.operator = makeAddr("operator");
        c.pauser = makeAddr("pauser");
        c.baseURI = "https://northeside.example/api/v1/badges/";
    }

    function test_deploy_handsOutRolesAndKeepsNone() public {
        DeployBadges.Config memory c = _config();
        NorthesideBadges b = NorthesideBadges(script.deploy(c, DEPLOYER_KEY));
        assertTrue(b.hasRole(b.DEFAULT_ADMIN_ROLE(), c.admin), "admin");
        assertTrue(b.hasRole(b.OPERATOR_ROLE(), c.operator), "operator");
        assertTrue(b.hasRole(b.PAUSER_ROLE(), c.pauser), "pauser");
        assertFalse(b.hasRole(b.DEFAULT_ADMIN_ROLE(), vm.addr(DEPLOYER_KEY)), "deployer has no role");
        assertTrue(keccak256(bytes(b.uri(1))) == keccak256("https://northeside.example/api/v1/badges/1"), "uri");
        assertEq(b.rounds(), 0, "no roots yet");
    }

    function test_validate_rejectsSharedKeysAndBadUri() public {
        DeployBadges.Config memory c = _config();
        c.pauser = c.operator;
        vm.expectRevert(bytes("pauser must be a key separate from the operator"));
        script.validate(c);
        c = _config();
        c.admin = c.operator;
        vm.expectRevert(bytes("admin must not share a key with the operator or pauser"));
        script.validate(c);
        c = _config();
        c.baseURI = "https://northeside.example/badges";
        vm.expectRevert(bytes("BADGES_BASE_URI must be a URL ending in /"));
        script.validate(c);
    }
}
