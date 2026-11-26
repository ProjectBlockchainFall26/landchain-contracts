// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LandAccessControl} from "./LandAccessControl.sol";
import {LandRoleGuard} from "./base/LandRoleGuard.sol";
import {TitleRegistry} from "./TitleRegistry.sol";

/// @title EncumbranceRegistry
/// @notice Claims against a registered title: a mortgage to a bank, a lien, a caveat lodged by someone who disputes
///         the title, a court order, or a lease. The registrar records each one and releases it when it ends
///         (loan repaid, caveat withdrawn, case decided). While a mortgage, lien, caveat or court order is
///         active, TitleRegistry refuses to start or approve a transfer, so land can't be sold out from under a
///         lender or a court. A lease is recorded for buyers to see but doesn't block a sale.
/// @dev No personal data on chain: `ref` is an official reference (deed, suit or caveat number) and
///      `docHash` the SHA-256 of the supporting document, which stays in the private vault.
contract EncumbranceRegistry is LandRoleGuard {
    enum Kind {
        Mortgage,
        Lien,
        Caveat,
        CourtOrder,
        Lease
    }

    struct Encumbrance {
        uint256 recordId;
        Kind kind;
        string ref; // e.g. "Mortgage deed GCB/2026/0041", "Suit No. LD/0123/2026"
        bytes32 docHash; // SHA-256 of the deed, order or caveat (0 if none)
        bool active;
        address registeredBy;
        uint64 registeredAt;
        address releasedBy;
        uint64 releasedAt;
        string releaseNote;
    }

    TitleRegistry public immutable titles;
    Encumbrance[] private _items; // encumbrance id = index + 1
    mapping(uint256 => uint256[]) private _of; // record id -> encumbrance ids
    mapping(uint256 => uint256) public blockingCount; // record id -> active encumbrances that block a transfer

    event EncumbranceRegistered(
        uint256 indexed encumbranceId, uint256 indexed recordId, Kind kind, string ref, address indexed by
    );
    event EncumbranceReleased(uint256 indexed encumbranceId, uint256 indexed recordId, string note, address indexed by);

    constructor(LandAccessControl acl_, TitleRegistry titles_) LandRoleGuard(acl_) {
        titles = titles_;
    }

    /// @notice Registrar records a claim against a registered title.
    function registerEncumbrance(uint256 recordId, Kind kind, string calldata ref, bytes32 docHash)
        external
        onlyLandRole(acl.REGISTRAR_ROLE(), "Only the registrar can record an encumbrance")
        returns (uint256 id)
    {
        require(recordId > 0 && recordId <= titles.parcelCount(), "Parcel does not exist");
        TitleRegistry.Status status = titles.getParcel(recordId).status;
        require(
            status == TitleRegistry.Status.Registered || status == TitleRegistry.Status.TransferPending,
            "Only a registered title can carry an encumbrance"
        );
        require(bytes(ref).length > 0, "Add the official reference (deed, suit or caveat number)");
        require(bytes(ref).length <= 120, "Keep the reference under 120 characters");

        _items.push(
            Encumbrance({
                recordId: recordId,
                kind: kind,
                ref: ref,
                docHash: docHash,
                active: true,
                registeredBy: msg.sender,
                registeredAt: uint64(block.timestamp),
                releasedBy: address(0),
                releasedAt: 0,
                releaseNote: ""
            })
        );
        id = _items.length;
        _of[recordId].push(id);
        if (blocksTransfer(kind)) blockingCount[recordId] += 1;
        emit EncumbranceRegistered(id, recordId, kind, ref, msg.sender);
    }

    /// @notice Registrar releases a claim once it has ended. The record stays in the history.
    function releaseEncumbrance(uint256 id, string calldata note)
        external
        onlyLandRole(acl.REGISTRAR_ROLE(), "Only the registrar can release an encumbrance")
    {
        require(id > 0 && id <= _items.length, "Encumbrance not found");
        Encumbrance storage e = _items[id - 1];
        require(e.active, "This encumbrance has already been released");
        require(bytes(note).length > 0, "Say why it is released (for example: loan repaid)");
        e.active = false;
        e.releasedBy = msg.sender;
        e.releasedAt = uint64(block.timestamp);
        e.releaseNote = note;
        if (blocksTransfer(e.kind)) blockingCount[e.recordId] -= 1;
        emit EncumbranceReleased(id, e.recordId, note, msg.sender);
    }

    /// @notice Mortgages, liens, caveats and court orders stop a sale; a lease runs with the land.
    function blocksTransfer(Kind kind) public pure returns (bool) {
        return kind != Kind.Lease;
    }

    function encumbranceCount() external view returns (uint256) {
        return _items.length;
    }

    function getEncumbrance(uint256 id) external view returns (Encumbrance memory) {
        require(id > 0 && id <= _items.length, "Encumbrance not found");
        return _items[id - 1];
    }

    function encumbrancesOf(uint256 recordId) external view returns (uint256[] memory) {
        return _of[recordId];
    }
}
