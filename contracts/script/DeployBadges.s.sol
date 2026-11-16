// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {vm} from "../test/utils/Vm.sol";
import {NorthesideBadges} from "../src/NorthesideBadges.sol";

/// @notice Deploys NorthesideBadges (soulbound achievement badges) and writes
///         deployments/<chainId>-badges.json.
///
/// Required env:
///   DEPLOYER_PRIVATE_KEY   pays for deployment (holds no role afterwards)
///   ADMIN_ADDRESS          cold key: revoke roots, unpause, change the metadata URL
///   OPERATOR_ADDRESS       posts badge roots (the ops worker key)
///   PAUSER_ADDRESS         emergency pause (must differ from the operator)
///   BADGES_BASE_URI        metadata base, e.g. https://northeside.netlify.app/api/v1/badges/
contract DeployBadges {
    struct Config {
        address admin;
        address operator;
        address pauser;
        string baseURI;
    }

    function run() external {
        Config memory c = configFromEnv();
        address badges = deploy(c, vm.envUint("DEPLOYER_PRIVATE_KEY"));
        string memory key = "badges";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "deployedAtBlock", block.number);
        string memory json = vm.serializeAddress(key, "badges", badges);
        vm.createDir("./deployments", true);
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), "-badges.json"));
    }

    function configFromEnv() public view returns (Config memory c) {
        c.admin = vm.envAddress("ADMIN_ADDRESS");
        c.operator = vm.envAddress("OPERATOR_ADDRESS");
        c.pauser = vm.envAddress("PAUSER_ADDRESS");
        c.baseURI = vm.envString("BADGES_BASE_URI");
    }

    function validate(Config memory c) public pure {
        require(c.admin != address(0) && c.operator != address(0) && c.pauser != address(0), "missing address");
        require(c.pauser != c.operator, "pauser must be a key separate from the operator");
        require(c.admin != c.operator && c.admin != c.pauser, "admin must not share a key with the operator or pauser");
        bytes memory u = bytes(c.baseURI);
        require(u.length > 8 && u[u.length - 1] == "/", "BADGES_BASE_URI must be a URL ending in /");
    }

    function deploy(Config memory c, uint256 deployerKey) public returns (address) {
        require(
            block.chainid == 1990 || block.chainid == 1983 || block.chainid == 31337,
            "unexpected chain: expected QIE mainnet (1990), QIE testnet (1983) or local (31337)"
        );
        validate(c);
        vm.startBroadcast(deployerKey);
        NorthesideBadges badges = new NorthesideBadges(c.admin, c.operator, c.pauser, c.baseURI);
        vm.stopBroadcast();
        return address(badges);
    }
}
