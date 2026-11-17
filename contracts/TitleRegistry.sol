// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {LandAccessControl} from "./LandAccessControl.sol";
import {LandRoleGuard} from "./base/LandRoleGuard.sol";
import {IdentityRegistry} from "./IdentityRegistry.sol";

/// @title TitleRegistry
/// @notice Every parcel is a record linked to its GPS boundary. A record becomes an ERC-721 land title only
///         after the surveyor, the lawyer and the registrar have each signed off, in that order.
/// @dev Records and titles are separate: a pending application has a record id but no token. The token id
///      (and title number) is assigned when the registrar finalises.
///      Titles cannot be moved with transferFrom; only agent contracts (Marketplace, DisputeResolution)
///      can change a title's status or owner, so every ownership change passes the registrar or a judge.
contract TitleRegistry is ERC721Enumerable, LandRoleGuard {
    enum Interest {
        Allodial,
        CustomaryFreehold,
        CommonLawFreehold,
        Leasehold
    }

    enum Status {
        Pending,
        Verified, // titled, not listed
        ForSale,
        InEscrow,
        Sold, // titled, last changed hands through a sale
        Frozen,
        Rejected
    }

    enum StepStatus {
        Waiting,
        Approved,
        Rejected
    }

    struct Doc {
        string docType; // Indenture, Site plan, Search report
        string name;
        bytes32 hash; // SHA-256 of the file; the file itself lives off chain
    }

    struct Parcel {
        string parcelId; // Lands Commission id, e.g. GA-BRK-0015
        Interest interest;
        string holder; // allodial holder: stool, skin or family
        string region;
        string location;
        uint32 acresX100; // area in hundredths of an acre (Solidity has no decimals)
        Status status;
        address owner;
        uint256 tokenId; // 0 until minted
        uint64 updatedAt;
    }

    struct Step {
        StepStatus status;
        address by;
        uint64 at;
        string reason;
    }

    struct Application {
        uint256 recordId;
        address applicant;
        uint64 createdAt;
        Step survey;
        Step legal;
        Step registrar;
    }

    struct ApplicationInput {
        string parcelId;
        Interest interest;
        string holder;
        string region;
        string location;
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

    Parcel[] private _parcels; // record id = index + 1
    mapping(uint256 => int32[]) private _lats;
    mapping(uint256 => int32[]) private _lngs;
    mapping(uint256 => Doc[]) private _docs;
    mapping(bytes32 => uint256) private _recordOfId; // keccak(parcelId) -> active record id
    mapping(bytes32 => uint256) private _recordOfBoundary; // keccak(lats, lngs) -> active record id
    mapping(uint256 => uint256) public recordOfToken;
    Application[] private _apps; // application id = index + 1
    uint256 public titleCount;

    event ApplicationSubmitted(
        uint256 indexed appId, uint256 indexed recordId, string parcelId, address indexed applicant, uint256 pillars
    );
    event StepApproved(uint256 indexed appId, uint256 indexed recordId, uint8 step, address indexed by);
    event ApplicationRejected(uint256 indexed appId, uint256 indexed recordId, uint8 step, address indexed by, string reason);
    event TitleMinted(uint256 indexed recordId, uint256 indexed tokenId, address indexed owner);
    event StatusChanged(uint256 indexed recordId, Status status, address indexed by);
    event TitleTransferred(uint256 indexed recordId, address indexed from, address indexed to);

    constructor(LandAccessControl acl_, IdentityRegistry identity_)
        ERC721("LandChain Ghana Title", "GLT")
        LandRoleGuard(acl_)
    {
        identity = identity_;
    }

    // ---------- registration ----------

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

        _parcels.push(
            Parcel({
                parcelId: input.parcelId,
                interest: input.interest,
                holder: input.holder,
                region: input.region,
                location: input.location,
                acresX100: input.acresX100,
                status: Status.Pending,
                owner: msg.sender,
                tokenId: 0,
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

    function approveSurvey(uint256 appId) external {
        _approve(appId, 0, acl.SURVEYOR_ROLE(), "Only the surveyor can sign this step");
    }

    function approveLegal(uint256 appId) external {
        _approve(appId, 1, acl.LAWYER_ROLE(), "Only the lawyer can sign this step");
    }

    /// @notice Registrar's final sign-off: mints the title NFT to the applicant.
    function finalise(uint256 appId) external {
        Application storage a = _approve(appId, 2, acl.REGISTRAR_ROLE(), "Only the registrar can sign this step");
        Parcel storage p = _parcels[a.recordId - 1];
        uint256 tokenId = ++titleCount;
        p.tokenId = tokenId;
        p.status = Status.Verified;
        p.updatedAt = uint64(block.timestamp);
        recordOfToken[tokenId] = a.recordId;
        _mint(p.owner, tokenId);
        emit TitleMinted(a.recordId, tokenId, p.owner);
    }

    /// @param step 0 survey, 1 legal, 2 registrar. Only the role for the current step can reject.
    function rejectApplication(uint256 appId, uint8 step, string calldata reason) external {
        Application storage a = _app(appId);
        require(step <= 2, "Unknown step");
        require(acl.hasRole(_stepRole(step), msg.sender), _stepRoleError(step));
        require(currentStep(appId) == step, unicode"Steps must happen in order: survey → legal → registrar");
        require(bytes(reason).length > 0, "A reason is required to reject");
        Step storage s = _step(a, step);
        s.status = StepStatus.Rejected;
        s.by = msg.sender;
        s.at = uint64(block.timestamp);
        s.reason = reason;

        Parcel storage p = _parcels[a.recordId - 1];
        p.status = Status.Rejected;
        p.updatedAt = uint64(block.timestamp);
        // Free the id and the boundary so a corrected application can be made.
        delete _recordOfId[keccak256(bytes(p.parcelId))];
        delete _recordOfBoundary[keccak256(abi.encode(_lats[a.recordId], _lngs[a.recordId]))];
        emit ApplicationRejected(appId, a.recordId, step, msg.sender, reason);
    }

    // ---------- agent-only (Marketplace, DisputeResolution) ----------

    function setStatus(uint256 recordId, Status status)
        external
        onlyLandRole(acl.AGENT_ROLE(), "Only a Lands Commission contract can change a title")
    {
        Parcel storage p = _record(recordId);
        require(p.tokenId != 0, "Parcel has no title yet");
        p.status = status;
        p.updatedAt = uint64(block.timestamp);
        emit StatusChanged(recordId, status, msg.sender);
    }

    function agentTransfer(uint256 recordId, address to)
        external
        onlyLandRole(acl.AGENT_ROLE(), "Only a Lands Commission contract can move a title")
    {
        Parcel storage p = _record(recordId);
        require(p.tokenId != 0, "Parcel has no title yet");
        address from = p.owner;
        _transfer(from, to, p.tokenId);
        p.owner = to;
        p.updatedAt = uint64(block.timestamp);
        emit TitleTransferred(recordId, from, to);
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

    /// @return 0 survey, 1 legal, 2 registrar, 3 done or rejected (nothing to sign)
    function currentStep(uint256 appId) public view returns (uint8) {
        Application storage a = _app(appId);
        Step[3] memory steps = [a.survey, a.legal, a.registrar];
        for (uint8 i = 0; i < 3; i++) {
            if (steps[i].status == StepStatus.Rejected) return 3;
            if (steps[i].status == StepStatus.Waiting) return i;
        }
        return 3;
    }

    // ---------- internals ----------

    function _approve(uint256 appId, uint8 step, bytes32 role, string memory roleError)
        private
        returns (Application storage a)
    {
        a = _app(appId);
        require(acl.hasRole(role, msg.sender), roleError);
        require(currentStep(appId) == step, unicode"Steps must happen in order: survey → legal → registrar");
        Step storage s = _step(a, step);
        s.status = StepStatus.Approved;
        s.by = msg.sender;
        s.at = uint64(block.timestamp);
        _parcels[a.recordId - 1].updatedAt = uint64(block.timestamp);
        emit StepApproved(appId, a.recordId, step, msg.sender);
    }

    function _app(uint256 appId) private view returns (Application storage) {
        require(appId > 0 && appId <= _apps.length, "Application not found");
        return _apps[appId - 1];
    }

    function _record(uint256 recordId) private view returns (Parcel storage) {
        require(recordId > 0 && recordId <= _parcels.length, "Parcel does not exist");
        return _parcels[recordId - 1];
    }

    function _step(Application storage a, uint8 step) private view returns (Step storage) {
        return step == 0 ? a.survey : step == 1 ? a.legal : a.registrar;
    }

    function _stepRole(uint8 step) private view returns (bytes32) {
        return step == 0 ? acl.SURVEYOR_ROLE() : step == 1 ? acl.LAWYER_ROLE() : acl.REGISTRAR_ROLE();
    }

    function _stepRoleError(uint8 step) private pure returns (string memory) {
        return step == 0
            ? "Only the surveyor can sign this step"
            : step == 1 ? "Only the lawyer can sign this step" : "Only the registrar can sign this step";
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

    /// @dev Internal mint and _transfer pass auth = address(0). Public transferFrom / safeTransferFrom pass
    ///      the caller as auth, so they are refused: titles move only through agentTransfer.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721Enumerable)
        returns (address)
    {
        require(auth == address(0), "Titles move only through a Lands Commission approved sale");
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
