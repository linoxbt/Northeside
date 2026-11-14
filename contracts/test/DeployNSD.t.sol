// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {vm} from "./utils/Vm.sol";
import {Base} from "./utils/Base.sol";
import {DeployNSD} from "../script/DeployNSD.s.sol";
import {NorthesideMatchweeks} from "../src/NorthesideMatchweeks.sol";
import {IdentityAdapter} from "../src/IdentityAdapter.sol";
import {NorthesideToken} from "../src/NorthesideToken.sol";
import {NSDRewards} from "../src/NSDRewards.sol";

contract DeployNSDTest is Base {
    uint256 internal constant DEPLOYER_KEY = 0xA11CE;
    DeployNSD internal script;
    address internal matchweeks;
    address internal identity;

    function setUp() public {
        script = new DeployNSD();
        address[] memory ch = new address[](1);
        ch[0] = makeAddr("challenger");
        matchweeks = address(new NorthesideMatchweeks(makeAddr("mwAdmin"), makeAddr("mwOp"), makeAddr("mwRes"), makeAddr("mwPause"), ch));
        identity = address(new IdentityAdapter(makeAddr("idAdmin"), makeAddr("attester")));
    }

    function _config() internal returns (DeployNSD.Config memory c) {
        c.admin = makeAddr("admin");
        c.operator = makeAddr("operator");
        c.pauser = makeAddr("pauser");
        c.treasury = makeAddr("treasury");
        c.matchweeks = matchweeks;
        c.identity = identity;
        c.supply = 100_000_000e18;
        c.maxPerMatchweek = 100_000e18;
    }

    function test_deploy_mintsToTreasuryAndHandsOutRoles() public {
        DeployNSD.Config memory c = _config();
        DeployNSD.Deployed memory d = script.deploy(c, DEPLOYER_KEY);
        NorthesideToken t = NorthesideToken(d.token);
        NSDRewards r = NSDRewards(d.rewards);
        assertEq(t.balanceOf(c.treasury), 100_000_000e18, "whole supply to the treasury");
        assertEq(t.balanceOf(vm.addr(DEPLOYER_KEY)), 0, "deployer holds nothing");
        assertEq(t.balanceOf(d.rewards), 0, "pool starts unfunded");
        assertTrue(r.hasRole(r.DEFAULT_ADMIN_ROLE(), c.admin), "admin");
        assertTrue(r.hasRole(r.OPERATOR_ROLE(), c.operator), "operator");
        assertTrue(r.hasRole(r.PAUSER_ROLE(), c.pauser), "pauser");
        assertFalse(r.hasRole(r.DEFAULT_ADMIN_ROLE(), vm.addr(DEPLOYER_KEY)), "deployer has no role");
        assertEq(address(r.token()), d.token, "token wired");
        assertEq(address(r.identity()), identity, "identity wired");
        assertEq(uint256(r.maxPerMatchweek()), 100_000e18, "cap");
    }

    function test_rejectsSharedKeysAndBadCaps() public {
        DeployNSD.Config memory c = _config();
        c.pauser = c.operator;
        vm.expectRevert(bytes("pauser must be a key separate from the operator"));
        script.deploy(c, DEPLOYER_KEY);
        c = _config();
        c.admin = c.operator;
        vm.expectRevert(bytes("admin must not share a key with the operator or pauser"));
        script.deploy(c, DEPLOYER_KEY);
        c = _config();
        c.maxPerMatchweek = uint128(c.supply + 1);
        vm.expectRevert(bytes("per-matchweek cap above total supply"));
        script.deploy(c, DEPLOYER_KEY);
        c = _config();
        c.identity = makeAddr("notAContract");
        vm.expectRevert(bytes("matchweeks/identity are not contracts"));
        script.deploy(c, DEPLOYER_KEY);
    }

    function test_rejectsUnknownChain() public {
        vm.chainId(1);
        vm.expectRevert(bytes("unexpected chain: expected QIE mainnet (1990), QIE testnet (1983) or local (31337)"));
        script.deploy(_config(), DEPLOYER_KEY);
    }
}
