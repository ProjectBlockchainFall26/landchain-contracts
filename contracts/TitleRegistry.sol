// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {LandAccessControl} from "./LandAccessControl.sol";
import {LandRoleGuard} from "./base/LandRoleGuard.sol";
import {IdentityRegistry} from "./IdentityRegistry.sol";

/// @notice What TitleRegistry needs to know from the FeeLedger: has the registrar recorded the receipts?
interface IFeeLedger {
    function isPaid(uint256 recordId, uint8 kind) external view returns (bool);
    function transferFeePaid(uint256 transferId) external view returns (bool);
}

/// @title TitleRegistry
/// @notice The land register. A verified owner applies to register a parcel (with its GPS boundary and
///         document hashes); the Lands Commission registrar approves it and an ERC-721 title is minted
///         to the owner. After that the record cannot be edited, and ownership changes only when the
///         owner requests a transfer AND the registrar approves it. Neither side can move a title alone.
/// @dev The sale itself happens off chain (indenture, lawyer, family or stool). This contract records
///      the result. A pending application has a record id but no token; the token is minted on approval.
contract TitleRegistry is ERC721Enumerable, LandRoleGuard {
    enum Interest {
        Allodial,
        CustomaryFreehold,
        CommonLawFreehold,
        Leasehold
    }

    enum Status {
        Pending, // applied, waiting for the registrar
        Registered, // title minted
        TransferPending, // owner asked to transfer, waiting for the registrar
        Rejected // application refused; the parcel id and boundary are free again
    }

    enum Decision {
        Waiting,
        Approved,
        Rejected,
        Cancelled
    }

    /// @dev Only the type and the fingerprint go on chain. The file (and its name, which may contain a person's
    ///      name) is held off chain by the Lands Commission, because everything in a contract is publicly readable.
    struct Doc {
        string docType; // Site plan, Indenture, Search report, Stool/family consent
        bytes32 hash; // SHA-256 of the file
    }

    struct Parcel {
        string parcelId; // Lands Commission id, e.g. GA-BRK-0015
        Interest interest;
        string holder; // allodial holder: stool, skin or family
        string region;
        string location;
        string planNumber; // regional / plan number from the approved site plan, e.g. SGE B4110/25
        string gpsAddress; // GhanaPostGPS digital address, e.g. EV-1715-0564
        uint32 acresX100; // area in hundredths of an acre (Solidity has no decimals)
        Status status;
        address owner;
        uint256 tokenId; // 0 until the registrar approves
        uint64 registeredAt;
        uint64 updatedAt;
    }

    struct Application {
        uint256 recordId;
        address applicant;
        uint64 createdAt;
        Decision decision;
        address decidedBy;
        uint64 decidedAt;
        string reason; // why it was rejected
    }

    struct TransferRequest {
        uint256 recordId;
        address from;
        address to;
        uint64 requestedAt;
        Decision decision;
        address decidedBy;
        uint64 decidedAt;
        string reason;
    }

    struct ApplicationInput {
        string parcelId;
        Interest interest;
        string holder;
        string region;
        string location;
        string planNumber;
        string gpsAddress;
        uint32 acresX100;
        int32[] lats; // micro-degrees: 5.603717 -> 5603717
        int32[] lngs;
        Doc[] docs;
    }

    // Ghana's bounding box in micro-degrees, so a typo cannot put a parcel at sea.
    int32 public constant MIN_LAT = 4_500_000;
    int32 public constant MAX_LAT = 11_200_000;
    int32 public constant MIN_LNG = -3_300_000;
    int32 public constant MAX_LNG = 1_300_000;

    IdentityRegistry public immutable identity;
    IFeeLedger public feeLedger; // set once by the admin after both contracts are deployed

    // FeeLedger kinds this contract checks (must match FeeLedger.Kind).
    uint8 private constant FEE_STAMP_DUTY = 1;
    uint8 private constant FEE_FIRST_REGISTRATION = 2;

    Parcel[] private _parcels; // record id = index + 1
    mapping(uint256 => int32[]) private _lats;
    mapping(uint256 => int32[]) private _lngs;
    mapping(uint256 => Doc[]) private _docs;
    mapping(uint256 => address[]) private _owners; // every owner of a record, oldest first
    mapping(bytes32 => uint256) private _recordOfId; // keccak(parcelId) -> active record id
    mapping(bytes32 => uint256) private _recordOfBoundary; // keccak(lats, lngs) -> active record id
    mapping(uint256 => uint256) public recordOfToken;
    mapping(uint256 => uint256) public openTransferOf; // record id -> pending transfer id (0 if none)
    Application[] private _apps; // application id = index + 1
    TransferRequest[] private _transfers; // transfer id = index + 1
    uint256 public titleCount;

    event ApplicationSubmitted(
        uint256 indexed appId, uint256 indexed recordId, string parcelId, address indexed applicant, uint256 pillars
    );
    event ApplicationApproved(uint256 indexed appId, uint256 indexed recordId, address indexed by);
    event ApplicationRejected(uint256 indexed appId, uint256 indexed recordId, address indexed by, string reason);
    event TitleMinted(uint256 indexed recordId, uint256 indexed tokenId, address indexed owner);
    event TransferRequested(uint256 indexed transferId, uint256 indexed recordId, address from, address indexed to);
    event TransferApproved(uint256 indexed transferId, uint256 indexed recordId, address from, address to, address indexed by);
    event TransferRejected(uint256 indexed transferId, uint256 indexed recordId, address indexed by, string reason);
    event TransferCancelled(uint256 indexed transferId, uint256 indexed recordId);

    constructor(LandAccessControl acl_, IdentityRegistry identity_)
        ERC721("LandChain Ghana Title", "GLT")
        LandRoleGuard(acl_)
    {
        identity = identity_;
    }

    /// @notice Connects the fee ledger. Once set, approvals require the matching fee receipts.
    function setFeeLedger(IFeeLedger ledger)
        external
        onlyLandRole(acl.DEFAULT_ADMIN_ROLE(), "Only the admin can connect the fee ledger")
    {
        require(address(feeLedger) == address(0), "Fee ledger already set");
        feeLedger = ledger;
    }

    // ---------- 1. registration ----------

    /// @notice A verified owner applies to register a parcel they already own off chain.
    function submitApplication(ApplicationInput calldata input) external returns (uint256 appId) {
        require(identity.isVerified(msg.sender), "Verify your identity before registering land");
        require(_validParcelId(input.parcelId), "Parcel ID must look like GA-BRK-0015");
        bytes32 idKey = keccak256(bytes(input.parcelId));
        require(_recordOfId[idKey] == 0, string.concat("Parcel ID ", input.parcelId, " is already used"));
        require(input.lats.length == input.lngs.length, "Latitudes and longitudes must pair up");
        require(input.lats.length >= 3, "A boundary needs at least 3 corner pillars");
        require(input.lats.length <= 32, "A boundary can have at most 32 corner pillars");
        for (uint256 i = 0; i < input.lats.length; i++) {
            require(
                input.lats[i] >= MIN_LAT && input.lats[i] <= MAX_LAT && input.lngs[i] >= MIN_LNG
                    && input.lngs[i] <= MAX_LNG,
                "All pillars must be inside Ghana"
            );
        }
        bytes32 boundaryKey = keccak256(abi.encode(input.lats, input.lngs));
        require(_recordOfBoundary[boundaryKey] == 0, "This boundary is already registered");
        require(input.acresX100 > 0, "Area must be greater than zero");
        require(bytes(input.holder).length > 0, "Name the allodial holder");
        require(bytes(input.planNumber).length > 0, "Add the regional plan number from the site plan");

        _parcels.push(
            Parcel({
                parcelId: input.parcelId,
                interest: input.interest,
                holder: input.holder,
                region: input.region,
                location: input.location,
                planNumber: input.planNumber,
                gpsAddress: input.gpsAddress,
                acresX100: input.acresX100,
                status: Status.Pending,
                owner: msg.sender,
                tokenId: 0,
                registeredAt: 0,
                updatedAt: uint64(block.timestamp)
            })
        );
        uint256 recordId = _parcels.length;
        _lats[recordId] = input.lats;
        _lngs[recordId] = input.lngs;
        for (uint256 i = 0; i < input.docs.length; i++) {
            _docs[recordId].push(input.docs[i]);
        }
        _recordOfId[idKey] = recordId;
        _recordOfBoundary[boundaryKey] = recordId;

        Application storage a = _apps.push();
        a.recordId = recordId;
        a.applicant = msg.sender;
        a.createdAt = uint64(block.timestamp);
        appId = _apps.length;
        emit ApplicationSubmitted(appId, recordId, input.parcelId, msg.sender, input.lats.length);
    }

    /// @notice Registrar approves: the title NFT is minted to the applicant and the record is locked.
    function approveApplication(uint256 appId)
        external
        onlyLandRole(acl.REGISTRAR_ROLE(), "Only the registrar can approve a registration")
    {
        Application storage a = _openApp(appId);
        if (address(feeLedger) != address(0)) {
            require(feeLedger.isPaid(a.recordId, FEE_STAMP_DUTY), "Record the stamp duty receipt before approving");
            require(feeLedger.isPaid(a.recordId, FEE_FIRST_REGISTRATION), "Record the registration fee before approving");
        }
        a.decision = Decision.Approved;
        a.decidedBy = msg.sender;
        a.decidedAt = uint64(block.timestamp);

        Parcel storage p = _parcels[a.recordId - 1];
        uint256 tokenId = ++titleCount;
        p.tokenId = tokenId;
        p.status = Status.Registered;
        p.registeredAt = uint64(block.timestamp);
        p.updatedAt = uint64(block.timestamp);
        recordOfToken[tokenId] = a.recordId;
        _owners[a.recordId].push(p.owner);
        _mint(p.owner, tokenId);
        emit ApplicationApproved(appId, a.recordId, msg.sender);
        emit TitleMinted(a.recordId, tokenId, p.owner);
    }

    function rejectApplication(uint256 appId, string calldata reason)
        external
        onlyLandRole(acl.REGISTRAR_ROLE(), "Only the registrar can reject a registration")
    {
        require(bytes(reason).length > 0, "A reason is required to reject");
        Application storage a = _openApp(appId);
        a.decision = Decision.Rejected;
        a.decidedBy = msg.sender;
        a.decidedAt = uint64(block.timestamp);
        a.reason = reason;

        Parcel storage p = _parcels[a.recordId - 1];
        p.status = Status.Rejected;
        p.updatedAt = uint64(block.timestamp);
        // Free the id and the boundary so a corrected application can be made.
        delete _recordOfId[keccak256(bytes(p.parcelId))];
        delete _recordOfBoundary[keccak256(abi.encode(_lats[a.recordId], _lngs[a.recordId]))];
        emit ApplicationRejected(appId, a.recordId, msg.sender, reason);
    }

    // ---------- 2. transfer of ownership (sale agreed off chain) ----------

    /// @notice The current owner asks the Lands Commission to record a new owner.
    function requestTransfer(uint256 recordId, address to) external returns (uint256 transferId) {
        Parcel storage p = _record(recordId);
        require(p.owner == msg.sender, "Only the owner can transfer this title");
        require(p.status == Status.Registered, "Only a registered title with no pending transfer can be transferred");
        require(to != msg.sender, "You already own this title");
        require(identity.isVerified(to), "The new owner must have a verified identity");

        _transfers.push(
            TransferRequest({
                recordId: recordId,
                from: msg.sender,
                to: to,
                requestedAt: uint64(block.timestamp),
                decision: Decision.Waiting,
                decidedBy: address(0),
                decidedAt: 0,
                reason: ""
            })
        );
        transferId = _transfers.length;
        openTransferOf[recordId] = transferId;
        p.status = Status.TransferPending;
        p.updatedAt = uint64(block.timestamp);
        emit TransferRequested(transferId, recordId, msg.sender, to);
    }

    /// @notice Owner withdraws a transfer request before the registrar decides.
    function cancelTransfer(uint256 transferId) external {
        TransferRequest storage t = _openTransfer(transferId);
        require(t.from == msg.sender, "Only the owner who asked can cancel this transfer");
        t.decision = Decision.Cancelled;
        t.decidedAt = uint64(block.timestamp);
        _closeTransfer(t);
        emit TransferCancelled(transferId, t.recordId);
    }

    /// @notice Registrar approves: the title NFT moves to the new owner and the owner history grows.
    function approveTransfer(uint256 transferId)
        external
        onlyLandRole(acl.REGISTRAR_ROLE(), "Only the registrar can approve a transfer")
    {
        TransferRequest storage t = _openTransfer(transferId);
        require(identity.isVerified(t.to), "The new owner must have a verified identity");
        if (address(feeLedger) != address(0)) {
            require(feeLedger.transferFeePaid(transferId), "Record the transfer fee before approving");
        }
        t.decision = Decision.Approved;
        t.decidedBy = msg.sender;
        t.decidedAt = uint64(block.timestamp);

        Parcel storage p = _parcels[t.recordId - 1];
        _transfer(t.from, t.to, p.tokenId); // internal: passes the _update guard below
        p.owner = t.to;
        _owners[t.recordId].push(t.to);
        _closeTransfer(t);
        emit TransferApproved(transferId, t.recordId, t.from, t.to, msg.sender);
    }

    function rejectTransfer(uint256 transferId, string calldata reason)
        external
        onlyLandRole(acl.REGISTRAR_ROLE(), "Only the registrar can reject a transfer")
    {
        require(bytes(reason).length > 0, "A reason is required to reject");
        TransferRequest storage t = _openTransfer(transferId);
        t.decision = Decision.Rejected;
        t.decidedBy = msg.sender;
        t.decidedAt = uint64(block.timestamp);
        t.reason = reason;
        _closeTransfer(t);
        emit TransferRejected(transferId, t.recordId, msg.sender, reason);
    }

    // ---------- reads ----------

    function parcelCount() external view returns (uint256) {
        return _parcels.length;
    }

    function getParcel(uint256 recordId) external view returns (Parcel memory) {
        return _record(recordId);
    }

    function getBoundary(uint256 recordId) external view returns (int32[] memory lats, int32[] memory lngs) {
        _record(recordId);
        return (_lats[recordId], _lngs[recordId]);
    }

    function getDocs(uint256 recordId) external view returns (Doc[] memory) {
        _record(recordId);
        return _docs[recordId];
    }

    /// @notice Every owner this title has had, oldest first. Empty until the title is minted.
    function ownerHistory(uint256 recordId) external view returns (address[] memory) {
        _record(recordId);
        return _owners[recordId];
    }

    /// @notice Active record for a parcel id (0 if none or if its application was rejected).
    function recordOfParcelId(string calldata parcelId) external view returns (uint256) {
        return _recordOfId[keccak256(bytes(parcelId))];
    }

    function applicationCount() external view returns (uint256) {
        return _apps.length;
    }

    function getApplication(uint256 appId) external view returns (Application memory) {
        return _app(appId);
    }

    function transferCount() external view returns (uint256) {
        return _transfers.length;
    }

    function getTransfer(uint256 transferId) external view returns (TransferRequest memory) {
        require(transferId > 0 && transferId <= _transfers.length, "Transfer not found");
        return _transfers[transferId - 1];
    }

    // ---------- internals ----------

    function _openApp(uint256 appId) private view returns (Application storage a) {
        a = _app(appId);
        require(a.decision == Decision.Waiting, "This application has already been decided");
    }

    function _openTransfer(uint256 transferId) private view returns (TransferRequest storage t) {
        require(transferId > 0 && transferId <= _transfers.length, "Transfer not found");
        t = _transfers[transferId - 1];
        require(t.decision == Decision.Waiting, "This transfer has already been decided");
    }

    function _closeTransfer(TransferRequest storage t) private {
        Parcel storage p = _parcels[t.recordId - 1];
        p.status = Status.Registered;
        p.updatedAt = uint64(block.timestamp);
        delete openTransferOf[t.recordId];
    }

    function _app(uint256 appId) private view returns (Application storage) {
        require(appId > 0 && appId <= _apps.length, "Application not found");
        return _apps[appId - 1];
    }

    function _record(uint256 recordId) private view returns (Parcel storage) {
        require(recordId > 0 && recordId <= _parcels.length, "Parcel does not exist");
        return _parcels[recordId - 1];
    }

    /// @dev AA-AAA-0000: two capitals, dash, three capitals, dash, four digits.
    function _validParcelId(string calldata id) private pure returns (bool) {
        bytes calldata b = bytes(id);
        if (b.length != 11 || b[2] != "-" || b[6] != "-") return false;
        for (uint256 i = 0; i < 11; i++) {
            if (i == 2 || i == 6) continue;
            bool upper = b[i] >= "A" && b[i] <= "Z";
            bool digit = b[i] >= "0" && b[i] <= "9";
            if (i < 6 ? !upper : !digit) return false;
        }
        return true;
    }

    // ---------- ERC-721 overrides ----------

    /// @dev Internal _mint and _transfer pass auth = address(0). Public transferFrom / safeTransferFrom pass
    ///      the caller as auth, so they are refused: a title moves only through approveTransfer.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721Enumerable)
        returns (address)
    {
        require(auth == address(0), "Titles move only through a registrar-approved transfer");
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
