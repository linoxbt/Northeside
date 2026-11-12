// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm, vm} from "./Vm.sol";

/// @notice Minimal test base: assertions that revert with readable messages.
abstract contract Base {
    function assertTrue(bool cond, string memory what) internal pure {
        if (!cond) revert(string.concat("assertTrue failed: ", what));
    }

    function assertFalse(bool cond, string memory what) internal pure {
        if (cond) revert(string.concat("assertFalse failed: ", what));
    }

    function assertEq(uint256 a, uint256 b, string memory what) internal pure {
        if (a != b) {
            revert(string.concat(what, ": ", vm.toString(a), " != ", vm.toString(b)));
        }
    }

    function assertEq(bytes32 a, bytes32 b, string memory what) internal pure {
        if (a != b) {
            revert(string.concat(what, ": ", vm.toString(a), " != ", vm.toString(b)));
        }
    }

    function assertEq(address a, address b, string memory what) internal pure {
        if (a != b) {
            revert(string.concat(what, ": ", vm.toString(a), " != ", vm.toString(b)));
        }
    }

    function assertLe(uint256 a, uint256 b, string memory what) internal pure {
        if (a > b) revert(string.concat(what, ": ", vm.toString(a), " > ", vm.toString(b)));
    }

    function bound(uint256 x, uint256 min, uint256 max) internal pure returns (uint256) {
        require(min <= max, "bound: min > max");
        if (x >= min && x <= max) return x;
        uint256 size = max - min + 1;
        return min + (x % size);
    }

    function makeAddr(string memory name) internal returns (address a) {
        a = vm.addr(uint256(keccak256(bytes(name))));
        vm.label(a, name);
    }
}
