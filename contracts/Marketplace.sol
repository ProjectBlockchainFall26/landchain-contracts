// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LandAccessControl} from "./LandAccessControl.sol";
import {LandRoleGuard} from "./base/LandRoleGuard.sol";
import {IdentityRegistry} from "./IdentityRegistry.sol";
import {TitleRegistry} from "./TitleRegistry.sol";

/// @title Marketplace
/// @notice Owners list titled parcels; buyers pay test cedis into escrow held by this contract; the registrar
///         approves (title to buyer, money to seller) or rejects (full refund). A buyer or seller can instead
///         send an escrowed sale to a judge through DisputeResolution.
contract Marketplace is LandRoleGuard, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum SaleStatus {
        Awaiting,
        Approved,
        Refunded,
        Disputed
    }

    struct Listing {
        uint256 price; // in tGHS base units (18 decimals)
        uint64 listedAt;
    }

    struct Sale {
        uint256 recordId;
        address buyer;
        address seller;
        uint256 amount;
        SaleStatus status;
        uint64 since;
    }

    IdentityRegistry public immutable identity;
    TitleRegistry public immutable titles;
    IERC20 public immutable tghs;

    mapping(uint256 => Listing) private _listings; // record id -> listing
    Sale[] private _sales; // sale id = index + 1

    event Listed(uint256 indexed recordId, address indexed seller, uint256 price);
    event ListingCancelled(uint256 indexed recordId, address indexed seller);
    event Purchased(uint256 indexed saleId, uint256 indexed recordId, address indexed buyer, address seller, uint256 amount);
    event SaleApproved(uint256 indexed saleId, address indexed by);
    event SaleRejected(uint256 indexed saleId, address indexed by);
    event SaleDisputed(uint256 indexed saleId, address indexed by);
    event SaleCompleted(uint256 indexed saleId, uint256 indexed recordId, address seller, address buyer, uint256 amount);
    event SaleRefunded(uint256 indexed saleId, uint256 indexed recordId, address buyer, uint256 amount);

    constructor(LandAccessControl acl_, IdentityRegistry identity_, TitleRegistry titles_, IERC20 tghs_)
        LandRoleGuard(acl_)
    {
        identity = identity_;
        titles = titles_;
        tghs = tghs_;
    }

    // ---------- owner ----------

    function listForSale(uint256 recordId, uint256 price) external {
        TitleRegistry.Parcel memory p = titles.getParcel(recordId);
        require(p.owner == msg.sender, "Only the owner can list this parcel");
        require(
            p.status == TitleRegistry.Status.Verified || p.status == TitleRegistry.Status.Sold,
            "Only verified titles that aren't already listed can be sold"
        );
        require(price > 0, "Price must be greater than zero");
        _listings[recordId] = Listing(price, uint64(block.timestamp));
        titles.setStatus(recordId, TitleRegistry.Status.ForSale);
        emit Listed(recordId, msg.sender, price);
    }

    function cancelListing(uint256 recordId) external {
        TitleRegistry.Parcel memory p = titles.getParcel(recordId);
        require(p.owner == msg.sender, "Only the owner can cancel");
        require(p.status == TitleRegistry.Status.ForSale, "Parcel is not listed");
        delete _listings[recordId];
        titles.setStatus(recordId, TitleRegistry.Status.Verified);
        emit ListingCancelled(recordId, msg.sender);
    }

    // ---------- buyer ----------

    /// @notice Pays the listed price into escrow. The buyer must first call tghs.approve(marketplace, price).
    function buyListed(uint256 recordId) external nonReentrant returns (uint256 saleId) {
        require(identity.isVerified(msg.sender), "Verify your identity before buying land");
        TitleRegistry.Parcel memory p = titles.getParcel(recordId);
        Listing memory l = _listings[recordId];
        require(p.status == TitleRegistry.Status.ForSale && l.price > 0, "Parcel is not for sale");
        require(p.owner != msg.sender, "You already own this parcel");
        require(tghs.balanceOf(msg.sender) >= l.price, unicode"Not enough tGHS — claim from the faucet on My Balance");
        require(tghs.allowance(msg.sender, address(this)) >= l.price, "Approve the escrow to take the payment first");

        tghs.safeTransferFrom(msg.sender, address(this), l.price);
        _sales.push(Sale(recordId, msg.sender, p.owner, l.price, SaleStatus.Awaiting, uint64(block.timestamp)));
        saleId = _sales.length;
        titles.setStatus(recordId, TitleRegistry.Status.InEscrow);
        emit Purchased(saleId, recordId, msg.sender, p.owner, l.price);
    }

    // ---------- registrar ----------

    function approveSale(uint256 saleId)
        external
        nonReentrant
        onlyLandRole(acl.REGISTRAR_ROLE(), "Only the registrar can approve sales")
    {
        Sale storage s = _sale(saleId);
        require(s.status == SaleStatus.Awaiting, "Sale is not awaiting approval");
        emit SaleApproved(saleId, msg.sender);
        _complete(saleId, s);
    }

    function rejectSale(uint256 saleId)
        external
        nonReentrant
        onlyLandRole(acl.REGISTRAR_ROLE(), "Only the registrar can reject sales")
    {
        Sale storage s = _sale(saleId);
        require(s.status == SaleStatus.Awaiting, "Sale is not awaiting approval");
        emit SaleRejected(saleId, msg.sender);
        _refund(saleId, s);
    }

    // ---------- DisputeResolution only ----------

    function markDisputed(uint256 saleId, address by)
        external
        onlyLandRole(acl.AGENT_ROLE(), "Only the dispute contract can do this")
    {
        Sale storage s = _sale(saleId);
        require(s.status == SaleStatus.Awaiting, "Only a sale in escrow can be disputed");
        s.status = SaleStatus.Disputed;
        emit SaleDisputed(saleId, by);
    }

    function settleDispute(uint256 saleId, bool favourSeller)
        external
        nonReentrant
        onlyLandRole(acl.AGENT_ROLE(), "Only the dispute contract can do this")
    {
        Sale storage s = _sale(saleId);
        require(s.status == SaleStatus.Disputed, "Sale is not under dispute");
        if (favourSeller) _complete(saleId, s);
        else _refund(saleId, s);
    }

    // ---------- reads ----------

    function listingOf(uint256 recordId) external view returns (Listing memory) {
        return _listings[recordId];
    }

    function saleCount() external view returns (uint256) {
        return _sales.length;
    }

    function getSale(uint256 saleId) external view returns (Sale memory) {
        return _sale(saleId);
    }

    // ---------- internals ----------

    function _complete(uint256 saleId, Sale storage s) private {
        s.status = SaleStatus.Approved;
        delete _listings[s.recordId];
        titles.agentTransfer(s.recordId, s.buyer);
        titles.setStatus(s.recordId, TitleRegistry.Status.Sold);
        tghs.safeTransfer(s.seller, s.amount);
        emit SaleCompleted(saleId, s.recordId, s.seller, s.buyer, s.amount);
    }

    function _refund(uint256 saleId, Sale storage s) private {
        s.status = SaleStatus.Refunded;
        delete _listings[s.recordId];
        titles.setStatus(s.recordId, TitleRegistry.Status.Verified);
        tghs.safeTransfer(s.buyer, s.amount);
        emit SaleRefunded(saleId, s.recordId, s.buyer, s.amount);
    }

    function _sale(uint256 saleId) private view returns (Sale storage) {
        require(saleId > 0 && saleId <= _sales.length, "Sale not found");
        return _sales[saleId - 1];
    }
}
