// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";

/// @title LandAccessControl
/// @notice One role hub for the whole system. Every other contract asks this hub "does X hold role Y?"
///         so there is exactly one list of who is a registrar, surveyor, lawyer, identity officer or judge.
/// @dev AGENT_ROLE is for contracts, not people: only agents may change a title's status or move a title.
///      Marketplace and DisputeResolution are the agents.
contract LandAccessControl is AccessControlEnumerable {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant SURVEYOR_ROLE = keccak256("SURVEYOR_ROLE");
    bytes32 public constant LAWYER_ROLE = keccak256("LAWYER_ROLE");
    bytes32 public constant ID_OFFICER_ROLE = keccak256("ID_OFFICER_ROLE");
    bytes32 public constant JUDGE_ROLE = keccak256("JUDGE_ROLE");
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice True if the account holds any Lands Commission role (registrar, surveyor, lawyer, ID officer, judge).
    function isOfficer(address account) public view returns (bool) {
        return hasRole(REGISTRAR_ROLE, account) || hasRole(SURVEYOR_ROLE, account) || hasRole(LAWYER_ROLE, account)
            || hasRole(ID_OFFICER_ROLE, account) || hasRole(JUDGE_ROLE, account);
    }

    /// @notice All officer roles of an account in one call (the front end uses this for the account switcher).
    function rolesOf(address account)
        external
        view
        returns (bool registrar, bool surveyor, bool lawyer, bool idOfficer, bool judge)
    {
        return (
            hasRole(REGISTRAR_ROLE, account),
            hasRole(SURVEYOR_ROLE, account),
            hasRole(LAWYER_ROLE, account),
            hasRole(ID_OFFICER_ROLE, account),
            hasRole(JUDGE_ROLE, account)
        );
    }
}
