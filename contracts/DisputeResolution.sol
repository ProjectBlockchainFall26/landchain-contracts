// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LandAccessControl} from "./LandAccessControl.sol";
import {LandRoleGuard} from "./base/LandRoleGuard.sol";
import {Marketplace} from "./Marketplace.sol";
import {TitleRegistry} from "./TitleRegistry.sol";

/// @title DisputeResolution
/// @notice The buyer or seller of an escrowed sale can send it to a judge. The judge rules for the seller
///         (sale completes) or for the buyer (full refund). A judge can also freeze a title by court order.
contract DisputeResolution is LandRoleGuard {
    struct Dispute {
        uint256 saleId;
        address raisedBy;
        string reason;
        bytes32 evidenceHash; // SHA-256 of the evidence file, kept off chain
        uint8 outcome; // 0 open, 1 for buyer (refund), 2 for seller (sale completes)
        address judge;
        uint64 raisedAt;
    }

    Marketplace public immutable market;
    TitleRegistry public immutable titles;
    Dispute[] private _disputes; // dispute id = index + 1

    event DisputeRaised(uint256 indexed disputeId, uint256 indexed saleId, address indexed by, string reason, bytes32 evidenceHash);
    event DisputeResolved(uint256 indexed disputeId, uint256 indexed saleId, bool favourSeller, address indexed judge);
    event TitleFrozen(uint256 indexed recordId, address indexed judge, string reason);
    event TitleUnfrozen(uint256 indexed recordId, address indexed judge);

    constructor(LandAccessControl acl_, Marketplace market_, TitleRegistry titles_) LandRoleGuard(acl_) {
        market = market_;
        titles = titles_;
    }

    function raiseDispute(uint256 saleId, string calldata reason, bytes32 evidenceHash) external returns (uint256 disputeId) {
        Marketplace.Sale memory s = market.getSale(saleId);
        require(s.buyer == msg.sender || s.seller == msg.sender, "Only the buyer or seller can raise a dispute");
        require(s.status == Marketplace.SaleStatus.Awaiting, "Only a sale in escrow can be disputed");
        require(bytes(reason).length > 0, "Give a reason for the dispute");
        market.markDisputed(saleId, msg.sender);
        _disputes.push(Dispute(saleId, msg.sender, reason, evidenceHash, 0, address(0), uint64(block.timestamp)));
        disputeId = _disputes.length;
        emit DisputeRaised(disputeId, saleId, msg.sender, reason, evidenceHash);
    }

    function resolveDispute(uint256 disputeId, bool favourSeller)
        external
        onlyLandRole(acl.JUDGE_ROLE(), "Only a judge can resolve disputes")
    {
        require(disputeId > 0 && disputeId <= _disputes.length, "Dispute not open");
        Dispute storage d = _disputes[disputeId - 1];
        require(d.outcome == 0, "Dispute not open");
        d.outcome = favourSeller ? 2 : 1;
        d.judge = msg.sender;
        emit DisputeResolved(disputeId, d.saleId, favourSeller, msg.sender);
        market.settleDispute(d.saleId, favourSeller);
    }

    function freezeTitle(uint256 recordId, string calldata reason)
        external
        onlyLandRole(acl.JUDGE_ROLE(), "Only a judge can freeze a title")
    {
        TitleRegistry.Status st = titles.getParcel(recordId).status;
        require(
            st == TitleRegistry.Status.Verified || st == TitleRegistry.Status.Sold,
            "Only a titled parcel that is not listed or in escrow can be frozen"
        );
        require(bytes(reason).length > 0, "Give the court order reference");
        titles.setStatus(recordId, TitleRegistry.Status.Frozen);
        emit TitleFrozen(recordId, msg.sender, reason);
    }

    function unfreezeTitle(uint256 recordId)
        external
        onlyLandRole(acl.JUDGE_ROLE(), "Only a judge can unfreeze a title")
    {
        require(titles.getParcel(recordId).status == TitleRegistry.Status.Frozen, "Title is not frozen");
        titles.setStatus(recordId, TitleRegistry.Status.Verified);
        emit TitleUnfrozen(recordId, msg.sender);
    }

    function disputeCount() external view returns (uint256) {
        return _disputes.length;
    }

    function getDispute(uint256 disputeId) external view returns (Dispute memory) {
        require(disputeId > 0 && disputeId <= _disputes.length, "Dispute not found");
        return _disputes[disputeId - 1];
    }
}
