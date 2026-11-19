// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";

/// @title LandAccessControl
/// @notice One role hub for the whole system. Every other contract asks this hub "does X hold role Y?"
///         so there is exactly one list of who works for the Lands Commission.
///         REGISTRAR_ROLE approves land registrations and ownership transfers.
///         ID_OFFICER_ROLE checks Ghana Card submissions.
contract LandAccessControl is AccessControlEnumerable {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant ID_OFFICER_ROLE = keccak256("ID_OFFICER_ROLE");

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice True if the account holds any Lands Commission role.
    function isOfficer(address account) public view returns (bool) {
        return hasRole(REGISTRAR_ROLE, account) || hasRole(ID_OFFICER_ROLE, account);
    }

    /// @notice All officer roles of an account in one call (the front end uses this for the account switcher).
    function rolesOf(address account) external view returns (bool registrar, bool idOfficer) {
        return (hasRole(REGISTRAR_ROLE, account), hasRole(ID_OFFICER_ROLE, account));
    }
}
