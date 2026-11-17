// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {LandAccessControl} from "./LandAccessControl.sol";
import {LandRoleGuard} from "./base/LandRoleGuard.sol";

/// @title TestCedi (tGHS)
/// @notice A mock cedi stablecoin so sales settle on chain without real money. Citizens claim
///         1,000,000 tGHS from the faucet once an hour.
contract TestCedi is ERC20, LandRoleGuard {
    uint256 public constant FAUCET_AMOUNT = 1_000_000 ether; // 18 decimals, like the cedi's pesewas but finer
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address => uint256) public lastFaucet;

    event FaucetClaimed(address indexed who, uint256 amount);

    constructor(LandAccessControl acl_) ERC20("Test Cedi", "tGHS") LandRoleGuard(acl_) {}

    function faucet() external {
        require(!acl.isOfficer(msg.sender), "Only citizen wallets can claim test cedis");
        require(
            lastFaucet[msg.sender] == 0 || block.timestamp >= lastFaucet[msg.sender] + FAUCET_COOLDOWN,
            unicode"Faucet already claimed — try again later"
        );
        lastFaucet[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Admin top-up, used only by the seed script to give demo accounts starting balances.
    function mint(address to, uint256 amount) external onlyLandRole(acl.DEFAULT_ADMIN_ROLE(), "Only the admin can mint") {
        _mint(to, amount);
    }
}
