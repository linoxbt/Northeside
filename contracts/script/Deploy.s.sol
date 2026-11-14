// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {vm} from "../test/utils/Vm.sol";
import {NorthesideMatchweeks} from "../src/NorthesideMatchweeks.sol";
import {INorthesideMatchweeks} from "../src/interfaces/INorthesideMatchweeks.sol";
import {HostRewards} from "../src/HostRewards.sol";
import {IdentityAdapter} from "../src/IdentityAdapter.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice Deploys the three Northeside contracts and writes deployments/<chainId>.json.
///
/// Required env:
///   DEPLOYER_PRIVATE_KEY   key that pays for deployment (holds no role afterwards)
///   ADMIN_ADDRESS          cold key (hardware wallet): DEFAULT_ADMIN_ROLE everywhere
///   OPERATOR_ADDRESS       creates matchweeks, posts reward roots
///   RESULTS_ADDRESS        proposes results, finalizes (separate from operator)
///   ATTESTER_ADDRESS       signs QIE Pass attestations
///   TREASURY_ADDRESS       receives the platform fee
///   QUSDC_ADDRESS          QUSDC token (checked: symbol QUSDC, 6 decimals). On a local chain
///                          (31337) it may be omitted and a mock is deployed.
/// Optional env:
///   PAUSER_ADDRESS (should be a key separate from the operator), CHALLENGER_ADDRESSES (comma-separated),
///   MAX_CAMPAIGN_BUDGET (default 500 QUSDC), MAX_TOTAL_LIABILITY (default 2,000 QUSDC)
contract Deploy {
    struct Config {
        address admin;
        address operator;
        address results;
        address pauser;
        address attester;
        address treasury;
        address qusdc;
        address[] challengers;
        uint128 maxCampaign;
        uint128 maxTotal;
    }

    /// Expected token addresses per chain live in config/known-tokens.json (no addresses in code).
    function _knownToken(uint256 chainId, string memory symbol) internal view returns (address) {
        string memory json = vm.readFile("./config/known-tokens.json");
        string memory key = string.concat(".", vm.toString(chainId), ".", symbol);
        return vm.keyExistsJson(json, key) ? vm.parseJsonAddress(json, key) : address(0);
    }

    struct Deployed {
        address qusdc;
        address matchweeks;
        address hostRewards;
        address identity;
    }

    function run() external {
        Config memory c = configFromEnv();
        Deployed memory d = deploy(c, vm.envUint("DEPLOYER_PRIVATE_KEY"));
        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "deployedAtBlock", block.number);
        vm.serializeAddress(key, "qusdc", d.qusdc);
        vm.serializeAddress(key, "matchweeks", d.matchweeks);
        vm.serializeAddress(key, "hostRewards", d.hostRewards);
        string memory json = vm.serializeAddress(key, "identity", d.identity);
        vm.createDir("./deployments", true);
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));
    }

    /// @notice Every check, then the three deployments. Takes an explicit config so it is testable.
    function deploy(Config memory c, uint256 deployerKey) public returns (Deployed memory d) {
        require(
            block.chainid == 1990 || block.chainid == 1983 || block.chainid == 31337,
            "unexpected chain: expected QIE mainnet (1990), QIE testnet (1983) or local (31337)"
        );
        validate(c);
        address known = _knownToken(block.chainid, "QUSDC");
        if (block.chainid == 1990) {
            require(known != address(0) && c.qusdc == known, "QUSDC_ADDRESS is not mainnet QUSDC");
        }

        vm.startBroadcast(deployerKey);

        if (c.qusdc == address(0)) {
            require(block.chainid == 31337, "QUSDC_ADDRESS required outside a local chain");
            MockERC20 mock = new MockERC20();
            mock.mint(vm.addr(deployerKey), 1_000_000e6);
            c.qusdc = address(mock);
        }
        _checkToken(c.qusdc);

        NorthesideMatchweeks matchweeks =
            new NorthesideMatchweeks(c.admin, c.operator, c.results, c.pauser, c.challengers);
        HostRewards rewards = new HostRewards(
            c.admin,
            c.operator,
            c.pauser,
            IERC20Metadata(c.qusdc),
            INorthesideMatchweeks(address(matchweeks)),
            c.treasury,
            c.maxCampaign,
            c.maxTotal
        );
        IdentityAdapter identity = new IdentityAdapter(c.admin, c.attester);

        vm.stopBroadcast();
        d = Deployed(c.qusdc, address(matchweeks), address(rewards), address(identity));
    }

    function configFromEnv() public view returns (Config memory c) {
        c.admin = vm.envAddress("ADMIN_ADDRESS");
        c.operator = vm.envAddress("OPERATOR_ADDRESS");
        c.results = vm.envAddress("RESULTS_ADDRESS");
        c.attester = vm.envAddress("ATTESTER_ADDRESS");
        c.treasury = vm.envAddress("TREASURY_ADDRESS");
        c.pauser = vm.envOr("PAUSER_ADDRESS", address(0));
        c.qusdc = vm.envOr("QUSDC_ADDRESS", address(0));
        string memory challengers = vm.envOr("CHALLENGER_ADDRESSES", string(""));
        if (bytes(challengers).length > 0) c.challengers = vm.envAddress("CHALLENGER_ADDRESSES", ",");
        uint256 maxCampaign = vm.envOr("MAX_CAMPAIGN_BUDGET", uint256(500e6));
        uint256 maxTotal = vm.envOr("MAX_TOTAL_LIABILITY", uint256(2_000e6));
        require(
            maxCampaign <= type(uint128).max && maxTotal <= type(uint128).max, "cap does not fit in uint128"
        );
        c.maxCampaign = uint128(maxCampaign);
        c.maxTotal = uint128(maxTotal);
    }

    /// @notice Key layout rules (audit L-6 / S2): independent challengers, separate operator and results
    ///         keys, a cold admin, and a pauser that is not the operator (a leaked operator key must not
    ///         be able to pause or, before v1.1, unpause).
    function validate(Config memory c) public pure {
        require(c.challengers.length > 0, "CHALLENGER_ADDRESSES is required");
        for (uint256 i = 0; i < c.challengers.length; ++i) {
            require(c.challengers[i] != address(0) && c.challengers[i] != c.results, "bad challenger");
            require(c.challengers[i] != c.admin, "challengers must not be the cold admin key");
        }
        require(c.operator != c.results, "operator and results keys must differ");
        require(c.admin != c.operator && c.admin != c.results, "admin must be a separate cold key");
        require(c.pauser == address(0) || c.pauser != c.operator, "pauser must be separate from the operator");
    }

    function _checkToken(address token) internal view {
        IERC20Metadata t = IERC20Metadata(token);
        require(t.decimals() == 6, "QUSDC must have 6 decimals");
        require(keccak256(bytes(t.symbol())) == keccak256("QUSDC"), "token symbol is not QUSDC");
    }
}
