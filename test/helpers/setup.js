// Deploys a fresh LandChain system for each test file, the same way the migration does.
const LandAccessControl = artifacts.require("LandAccessControl");
const IdentityRegistry = artifacts.require("IdentityRegistry");
const TitleRegistry = artifacts.require("TitleRegistry");
const FeeLedger = artifacts.require("FeeLedger");
const EncumbranceRegistry = artifacts.require("EncumbranceRegistry");

async function deploySystem(accounts) {
  const [registrar, idOfficer] = accounts;
  const acl = await LandAccessControl.new(registrar);
  const identity = await IdentityRegistry.new(acl.address);
  const titles = await TitleRegistry.new(acl.address, identity.address);
  const fees = await FeeLedger.new(acl.address, titles.address);
  await titles.setFeeLedger(fees.address, { from: registrar });
  const encumbrances = await EncumbranceRegistry.new(acl.address, titles.address);
  await titles.setEncumbranceRegistry(encumbrances.address, { from: registrar });
  await acl.grantRole(await acl.REGISTRAR_ROLE(), registrar);
  await acl.grantRole(await acl.ID_OFFICER_ROLE(), idOfficer);
  return { acl, identity, titles, fees, encumbrances, registrar, idOfficer };
}

const cardHash = (n) => web3.utils.soliditySha3(`landchain-card:GHA-70000000${n}-${n}`);

async function verifiedCitizen(sys, who, n) {
  await sys.identity.submitProfile(cardHash(n), true, { from: who });
  await sys.identity.verifyProfile(who, { from: sys.idOfficer });
}

// A square boundary near Berekuso, offset so every parcel is distinct.
function square(offset = 0) {
  const lat = 5750500 + offset * 2000, lng = -227500 + offset * 2000, d = 1000;
  return { lats: [lat, lat, lat + d, lat + d], lngs: [lng, lng + d, lng + d, lng] };
}

function application(parcelId, offset = 0) {
  const { lats, lngs } = square(offset);
  return {
    parcelId, interest: 1, holder: "Berekuso Stool", region: "Eastern", location: "Berekuso, Eastern Region",
    planNumber: `SGE B${parcelId.slice(-4)}/26`, gpsAddress: "EV-1715-0564",
    acresX100: 620, lats, lngs,
    docs: [{ docType: "Indenture", hash: web3.utils.soliditySha3(parcelId) }],
  };
}

const FEE = { OfficialSearch: 0, StampDuty: 1, FirstRegistration: 2, Transfer: 3 };
let receiptNo = 0;
/** keccak256 of a fresh official receipt number. */
const receipt = () => web3.utils.soliditySha3(`LC-RCPT-${++receiptNo}`);

/** The registrar records the stamp duty and registration fee receipts for a parcel. */
async function payRegistrationFees(sys, recordId) {
  await sys.fees.recordPayment(recordId, FEE.StampDuty, 60000, receipt(), { from: sys.registrar });
  await sys.fees.recordPayment(recordId, FEE.FirstRegistration, 117800, receipt(), { from: sys.registrar });
}

/** Applies, fees recorded, then the registrar approves. Returns the record id of the new title. */
async function titledParcel(sys, owner, parcelId, offset) {
  await sys.titles.submitApplication(application(parcelId, offset), { from: owner });
  const appId = Number(await sys.titles.applicationCount());
  await payRegistrationFees(sys, Number(await sys.titles.recordOfParcelId(parcelId)));
  await sys.titles.approveApplication(appId, { from: sys.registrar });
  return Number(await sys.titles.recordOfParcelId(parcelId));
}

async function expectRevert(promise, message) {
  try {
    await promise;
  } catch (e) {
    const text = e.reason || e.message || "";
    assert(text.includes(message), `Expected revert "${message}", got "${text}"`);
    return;
  }
  assert.fail(`Expected revert "${message}" but the call succeeded`);
}

// Status enums as web3 returns them (strings).
const STATUS = { Pending: "0", Registered: "1", TransferPending: "2", Rejected: "3" };
const DECISION = { Waiting: "0", Approved: "1", Rejected: "2", Cancelled: "3" };
const ENCUMBRANCE = { Mortgage: 0, Lien: 1, Caveat: 2, CourtOrder: 3, Lease: 4 };

module.exports = { deploySystem, verifiedCitizen, application, titledParcel, payRegistrationFees, receipt, FEE, expectRevert, cardHash, square, STATUS, DECISION, ENCUMBRANCE };
