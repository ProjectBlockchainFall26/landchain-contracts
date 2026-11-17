// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LandAccessControl} from "../LandAccessControl.sol";

/// @title LandRoleGuard
/// @notice Abstract parent: gives a contract a reference to the role hub and a modifier with a readable error.
/// @dev Roles are not inherited into every contract (that would mean six separate role lists and
///      diamond-inheritance clashes). Each contract asks the one shared hub instead.
abstract contract LandRoleGuard {
    LandAccessControl public immutable acl;

    constructor(LandAccessControl acl_) {
        acl = acl_;
    }

    modifier onlyLandRole(bytes32 role, string memory message) {
        require(acl.hasRole(role, msg.sender), message);
        _;
    }
}
