// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LandAccessControl} from "./LandAccessControl.sol";
import {LandRoleGuard} from "./base/LandRoleGuard.sol";
import {TitleRegistry} from "./TitleRegistry.sol";

/// @title FeeLedger
/// @notice Receipts for what an owner pays to register land. The money itself is paid in cedis off chain (to the
///         Lands Commission, and stamp duty to the GRA). The registrar records each payment here with the amount
///         and a hash of the official receipt number, so a receipt can't be invented, changed or used twice later.
///         TitleRegistry refuses to approve a registration or transfer until the matching receipts are recorded.
/// @dev Amounts are public on chain, like everything else; the official fee schedule is public anyway.
///      The receipt number itself stays off chain; only its keccak256 is stored.
contract FeeLedger is LandRoleGuard {
    enum Kind {
        OfficialSearch, // Lands Commission search report
        StampDuty, // paid to the GRA, 0.25% to 1% of the consideration
        FirstRegistration, // Lands Commission, per acre or part
        Transfer // Lands Commission, per acre or part, for a change of owner
    }

    struct Payment {
        uint256 recordId;
        Kind kind;
        uint64 amountPesewas; // GH₵ 1 = 100 pesewas (Solidity has no decimals)
        bytes32 receiptHash; // keccak256 of the official receipt number
        address payer; // owner of the parcel when the fee was paid
        address recordedBy;
        uint64 at;
        uint256 transferId; // for Kind.Transfer: which transfer request it pays for
    }

    TitleRegistry public immutable titles;
    Payment[] private _payments; // payment id = index + 1
    mapping(uint256 => uint256[]) private _paymentsOf; // record id -> payment ids
    mapping(uint256 => mapping(uint8 => bool)) private _paid; // record id -> kind -> recorded?
    mapping(uint256 => bool) public transferFeePaid; // transfer id -> recorded?
    mapping(bytes32 => bool) public receiptUsed;

    event PaymentRecorded(
        uint256 indexed paymentId, uint256 indexed recordId, Kind kind, uint64 amountPesewas, bytes32 receiptHash, address indexed by
    );

    constructor(LandAccessControl acl_, TitleRegistry titles_) LandRoleGuard(acl_) {
        titles = titles_;
    }

    function recordPayment(uint256 recordId, Kind kind, uint64 amountPesewas, bytes32 receiptHash)
        external
        onlyLandRole(acl.REGISTRAR_ROLE(), "Only the registrar can record a payment")
        returns (uint256 paymentId)
    {
        require(recordId > 0 && recordId <= titles.parcelCount(), "Parcel does not exist");
        require(amountPesewas > 0, "Amount must be greater than zero");
        require(receiptHash != bytes32(0), "Add the official receipt number");
        require(!receiptUsed[receiptHash], "This receipt has already been recorded");

        uint256 transferId;
        if (kind == Kind.Transfer) {
            transferId = titles.openTransferOf(recordId);
            require(transferId != 0, "There is no transfer waiting for this parcel");
            require(!transferFeePaid[transferId], "The transfer fee is already recorded");
            transferFeePaid[transferId] = true;
        } else {
            require(!_paid[recordId][uint8(kind)], "This fee is already recorded for the parcel");
        }

        receiptUsed[receiptHash] = true;
        _paid[recordId][uint8(kind)] = true;
        _payments.push(
            Payment({
                recordId: recordId,
                kind: kind,
                amountPesewas: amountPesewas,
                receiptHash: receiptHash,
                payer: titles.getParcel(recordId).owner,
                recordedBy: msg.sender,
                at: uint64(block.timestamp),
                transferId: transferId
            })
        );
        paymentId = _payments.length;
        _paymentsOf[recordId].push(paymentId);
        emit PaymentRecorded(paymentId, recordId, kind, amountPesewas, receiptHash, msg.sender);
    }

    // ---------- reads ----------

    function isPaid(uint256 recordId, uint8 kind) external view returns (bool) {
        return _paid[recordId][kind];
    }

    function paymentCount() external view returns (uint256) {
        return _payments.length;
    }

    function getPayment(uint256 paymentId) external view returns (Payment memory) {
        require(paymentId > 0 && paymentId <= _payments.length, "Payment not found");
        return _payments[paymentId - 1];
    }

    function paymentsOf(uint256 recordId) external view returns (uint256[] memory) {
        return _paymentsOf[recordId];
    }
}
