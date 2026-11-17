// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LandAccessControl} from "./LandAccessControl.sol";
import {LandRoleGuard} from "./base/LandRoleGuard.sol";

/// @title IdentityRegistry
/// @notice Links a wallet to a Ghana Card without putting the card number or the person's name on chain.
///         The browser hashes the card number; only that hash is stored. An identity officer verifies it.
contract IdentityRegistry is LandRoleGuard {
    enum Status {
        None,
        Pending,
        Verified,
        Rejected
    }

    struct Profile {
        Status status;
        bool citizen; // Ghanaian citizen or not (Land Act 2020 treats them differently)
        bytes32 cardHash;
        uint64 updatedAt;
    }

    mapping(address => Profile) private _profiles;
    mapping(bytes32 => address) public cardOwner;
    address[] private _members;

    event ProfileSubmitted(address indexed who, bytes32 cardHash, bool citizen);
    event ProfileVerified(address indexed who, address indexed by);
    event ProfileRejected(address indexed who, address indexed by);

    constructor(LandAccessControl acl_) LandRoleGuard(acl_) {}

    /// @notice A citizen submits (or resubmits after a rejection) their hashed Ghana Card.
    function submitProfile(bytes32 cardHash, bool citizen) external {
        require(!acl.isOfficer(msg.sender), "Only citizens can submit a profile");
        require(cardHash != bytes32(0), "Card hash is empty");
        Profile storage p = _profiles[msg.sender];
        require(p.status != Status.Verified, "Identity already verified");
        require(p.status != Status.Pending, "Your profile is already waiting for review");
        address linked = cardOwner[cardHash];
        require(linked == address(0) || linked == msg.sender, "This Ghana Card is already linked to another profile");

        if (p.status == Status.None) _members.push(msg.sender);
        if (p.cardHash != bytes32(0) && p.cardHash != cardHash) delete cardOwner[p.cardHash];
        cardOwner[cardHash] = msg.sender;
        p.status = Status.Pending;
        p.citizen = citizen;
        p.cardHash = cardHash;
        p.updatedAt = uint64(block.timestamp);
        emit ProfileSubmitted(msg.sender, cardHash, citizen);
    }

    function verifyProfile(address who) external onlyLandRole(acl.ID_OFFICER_ROLE(), "Only an identity officer can do this") {
        Profile storage p = _profiles[who];
        require(p.status == Status.Pending, "No pending request for this person");
        p.status = Status.Verified;
        p.updatedAt = uint64(block.timestamp);
        emit ProfileVerified(who, msg.sender);
    }

    function rejectProfile(address who) external onlyLandRole(acl.ID_OFFICER_ROLE(), "Only an identity officer can do this") {
        Profile storage p = _profiles[who];
        require(p.status == Status.Pending, "No pending request for this person");
        p.status = Status.Rejected;
        p.updatedAt = uint64(block.timestamp);
        // Free the card so the person can correct and resubmit.
        delete cardOwner[p.cardHash];
        emit ProfileRejected(who, msg.sender);
    }

    // ---------- reads ----------
    function profileOf(address who) external view returns (Profile memory) {
        return _profiles[who];
    }

    function isVerified(address who) external view returns (bool) {
        return _profiles[who].status == Status.Verified;
    }

    function isCitizen(address who) external view returns (bool) {
        return _profiles[who].citizen;
    }

    /// @notice Pseudonymous public ID shown in the app, e.g. GH-7d4e894d (first 4 bytes of keccak256(address)).
    function publicIdOf(address who) external pure returns (bytes4) {
        return bytes4(keccak256(abi.encodePacked(who)));
    }

    function memberCount() external view returns (uint256) {
        return _members.length;
    }

    function members() external view returns (address[] memory) {
        return _members;
    }
}
