// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice 6-decimal stand-in for QUSDC.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock QUSDC", "QUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Takes 1% on every transfer; HostRewards must refuse it.
contract FeeOnTransferERC20 is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xdead), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

interface IClaimTarget {
    function claim(
        uint256 id,
        uint32 matchweekId,
        address host,
        uint128 amount,
        uint32 countablePlayers,
        bytes32[] calldata proof
    ) external;
}

/// @notice On an outgoing transfer, tries to re-enter HostRewards.claim with the same arguments.
contract ReentrantERC20 is ERC20 {
    IClaimTarget public target;
    bytes public reentryCall;
    bool private _entered;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(IClaimTarget target_, bytes calldata call_) external {
        target = target_;
        reentryCall = call_;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from == address(target) && address(target) != address(0) && !_entered) {
            _entered = true;
            (bool ok, bytes memory ret) = address(target).call(reentryCall);
            if (!ok) {
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
    }
}
