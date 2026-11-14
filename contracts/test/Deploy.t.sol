// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {vm} from "./utils/Vm.sol";
import {Base} from "./utils/Base.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {NorthesideMatchweeks} from "../src/NorthesideMatchweeks.sol";
import {HostRewards} from "../src/HostRewards.sol";
import {IdentityAdapter} from "../src/IdentityAdapter.sol";

/// @notice The deploy script's safety checks (audit L-6 / G11) and the roles it hands out. Configs are
///         passed explicitly: environment variables are process-wide and tests run in parallel.
contract DeployTest is Base {
    // anvil's first key: a throwaway local key, never used on a real chain
    uint256 internal constant DEPLOYER_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    Deploy internal script;

    function setUp() public {
        script = new Deploy();
    }

    function _config() internal returns (Deploy.Config memory c) {
        c.admin = makeAddr("admin");
        c.operator = makeAddr("operator");
        c.results = makeAddr("results");
        c.pauser = makeAddr("pauser");
        c.attester = makeAddr("attester");
        c.treasury = makeAddr("treasury");
        c.challengers = new address[](2);
        c.challengers[0] = makeAddr("challenger1");
        c.challengers[1] = makeAddr("challenger2");
        c.maxCampaign = 500e6;
        c.maxTotal = 2_000e6;
    }

    function test_localDeployHandsOutRoles() public {
        Deploy.Config memory c = _config();
        Deploy.Deployed memory d = script.deploy(c, DEPLOYER_KEY);
        NorthesideMatchweeks mw = NorthesideMatchweeks(d.matchweeks);
        HostRewards hr = HostRewards(d.hostRewards);
        IdentityAdapter id = IdentityAdapter(d.identity);
        assertTrue(mw.hasRole(mw.DEFAULT_ADMIN_ROLE(), c.admin), "admin on matchweeks");
        assertTrue(hr.hasRole(hr.DEFAULT_ADMIN_ROLE(), c.admin), "admin on rewards");
        assertTrue(id.hasRole(id.DEFAULT_ADMIN_ROLE(), c.admin), "admin on identity");
        assertTrue(mw.hasRole(mw.CHALLENGER_ROLE(), c.challengers[1]), "second challenger");
        assertTrue(mw.hasRole(mw.PAUSER_ROLE(), c.pauser), "separate pauser");
        assertFalse(mw.hasRole(mw.PAUSER_ROLE(), c.operator), "operator is not the pauser");
        assertFalse(mw.hasRole(mw.DEFAULT_ADMIN_ROLE(), vm.addr(DEPLOYER_KEY)), "deployer keeps no role");
        assertEq(hr.maxCampaignBudget(), 500e6, "campaign cap");
    }

    function test_requiresChallengers() public {
        Deploy.Config memory c = _config();
        c.challengers = new address[](0);
        vm.expectRevert(bytes("CHALLENGER_ADDRESSES is required"));
        script.validate(c);
    }

    function test_rejectsResultsKeyOrAdminAsChallenger() public {
        Deploy.Config memory c = _config();
        c.challengers[0] = c.results;
        vm.expectRevert(bytes("bad challenger"));
        script.validate(c);
        c.challengers[0] = c.admin;
        vm.expectRevert(bytes("challengers must not be the cold admin key"));
        script.validate(c);
    }

    function test_rejectsSharedKeys() public {
        Deploy.Config memory c = _config();
        c.results = c.operator;
        c.challengers[0] = makeAddr("x");
        vm.expectRevert(bytes("operator and results keys must differ"));
        script.validate(c);
        c = _config();
        c.pauser = c.operator;
        vm.expectRevert(bytes("pauser must be separate from the operator"));
        script.validate(c);
        c = _config();
        c.admin = c.operator;
        vm.expectRevert(bytes("admin must be a separate cold key"));
        script.validate(c);
    }

    function test_mainnetRequiresKnownQusdc() public {
        vm.chainId(1990);
        Deploy.Config memory c = _config();
        c.qusdc = makeAddr("fakeQusdc");
        vm.expectRevert(bytes("QUSDC_ADDRESS is not mainnet QUSDC"));
        script.deploy(c, DEPLOYER_KEY);
    }

    function test_rejectsUnknownChain() public {
        vm.chainId(5);
        Deploy.Config memory c = _config();
        vm.expectRevert(
            bytes("unexpected chain: expected QIE mainnet (1990), QIE testnet (1983) or local (31337)")
        );
        script.deploy(c, DEPLOYER_KEY);
    }
}
