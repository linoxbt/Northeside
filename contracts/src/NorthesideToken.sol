// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title NorthesideToken ($NSD)
/// @notice A plain, fixed-supply ERC-20. The whole supply is minted once, at deployment, to one
///         recipient (a treasury or the rewards contract). There is no owner, no minting, no
///         pausing and no upgrade path: nobody can create more $NSD or freeze anyone's balance.
contract NorthesideToken is ERC20 {
    error InvalidParams();

    constructor(string memory name_, string memory symbol_, uint256 supply, address recipient) ERC20(name_, symbol_) {
        if (supply == 0 || recipient == address(0)) revert InvalidParams();
        _mint(recipient, supply);
    }
}
