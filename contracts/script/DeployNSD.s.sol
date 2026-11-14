// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {vm} from "../test/utils/Vm.sol";
import {NorthesideToken} from "../src/NorthesideToken.sol";
import {NSDRewards, IPersonRegistry} from "../src/NSDRewards.sol";
import {INorthesideMatchweeks} from "../src/interfaces/INorthesideMatchweeks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys $NSD (fixed supply, minted once to the treasury) and the NSDRewards pool, and
///         writes deployments/<chainId>-nsd.json. Funding the pool is a separate transfer from the
///         treasury, so nothing is paid out until the owner decides to fund it.
///
/// Required env:
///   DEPLOYER_PRIVATE_KEY   pays for deployment (holds no role and no tokens afterwards)
///   ADMIN_ADDRESS          cold key: DEFAULT_ADMIN_ROLE on NSDRewards (void roots, unpause, withdraw)
///   OPERATOR_ADDRESS       posts reward roots
///   PAUSER_ADDRESS         emergency pause (must differ from the operator)
///   NSD_TREASURY_ADDRESS   receives the whole supply
///   MATCHWEEKS_ADDRESS, IDENTITY_ADDRESS   the live Northeside contracts
///   NSD_SUPPLY             whole tokens, e.g. 100000000
///   NSD_MAX_PER_MATCHWEEK  whole tokens, the most one matchweek's root may allocate
contract DeployNSD {
    struct Config {
        address admin;
        address operator;
        address pauser;
        address treasury;
        address matchweeks;
        address identity;
        uint256 supply; // base units (18 decimals)
        uint128 maxPerMatchweek; // base units
    }

    struct Deployed {
        address token;
        address rewards;
    }

    function run() external {
        Config memory c = configFromEnv();
        Deployed memory d = deploy(c, vm.envUint("DEPLOYER_PRIVATE_KEY"));
        string memory key = "nsd";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "deployedAtBlock", block.number);
        vm.serializeAddress(key, "token", d.token);
        string memory json = vm.serializeAddress(key, "rewards", d.rewards);
        vm.createDir("./deployments", true);
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), "-nsd.json"));
    }

    function configFromEnv() public view returns (Config memory c) {
        c.admin = vm.envAddress("ADMIN_ADDRESS");
        c.operator = vm.envAddress("OPERATOR_ADDRESS");
        c.pauser = vm.envAddress("PAUSER_ADDRESS");
        c.treasury = vm.envAddress("NSD_TREASURY_ADDRESS");
        c.matchweeks = vm.envAddress("MATCHWEEKS_ADDRESS");
        c.identity = vm.envAddress("IDENTITY_ADDRESS");
        c.supply = vm.envUint("NSD_SUPPLY") * 1e18;
        c.maxPerMatchweek = uint128(vm.envUint("NSD_MAX_PER_MATCHWEEK") * 1e18);
    }

    function validate(Config memory c) public pure {
        require(
            c.admin != address(0) && c.operator != address(0) && c.pauser != address(0) && c.treasury != address(0)
                && c.matchweeks != address(0) && c.identity != address(0),
            "missing address"
        );
        require(c.pauser != c.operator, "pauser must be a key separate from the operator");
        require(c.admin != c.operator && c.admin != c.pauser, "admin must not share a key with the operator or pauser");
        require(c.supply > 0 && c.maxPerMatchweek > 0, "supply and per-matchweek cap must be positive");
        require(c.maxPerMatchweek <= c.supply, "per-matchweek cap above total supply");
    }

    /// @notice Every check, then both deployments. Takes an explicit config so it is testable.
    function deploy(Config memory c, uint256 deployerKey) public returns (Deployed memory d) {
        require(
            block.chainid == 1990 || block.chainid == 1983 || block.chainid == 31337,
            "unexpected chain: expected QIE mainnet (1990), QIE testnet (1983) or local (31337)"
        );
        validate(c);
        require(c.matchweeks.code.length > 0 && c.identity.code.length > 0, "matchweeks/identity are not contracts");
        vm.startBroadcast(deployerKey);
        NorthesideToken token = new NorthesideToken("Northeside", "NSD", c.supply, c.treasury);
        NSDRewards rewards = new NSDRewards(
            c.admin,
            c.operator,
            c.pauser,
            IERC20(address(token)),
            INorthesideMatchweeks(c.matchweeks),
            IPersonRegistry(c.identity),
            c.maxPerMatchweek
        );
        vm.stopBroadcast();
        d = Deployed({token: address(token), rewards: address(rewards)});
    }
}
