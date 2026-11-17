// Deploys a fresh LandChain system for each test file, the same way the migration does.
const LandAccessControl = artifacts.require("LandAccessControl");
const IdentityRegistry = artifacts.require("IdentityRegistry");
const TestCedi = artifacts.require("TestCedi");
const TitleRegistry = artifacts.require("TitleRegistry");
const Marketplace = artifacts.require("Marketplace");
const DisputeResolution = artifacts.require("DisputeResolution");

async function deploySystem(accounts) {
  const [admin, surveyor, lawyer, idOfficer, judge] = accounts;
  const acl = await LandAccessControl.new(admin);
  const identity = await IdentityRegistry.new(acl.address);
  const tghs = await TestCedi.new(acl.address);
  const titles = await TitleRegistry.new(acl.address, identity.address);
  const market = await Marketplace.new(acl.address, identity.address, titles.address, tghs.address);
  const disputes = await DisputeResolution.new(acl.address, market.address, titles.address);
  await acl.grantRole(await acl.AGENT_ROLE(), market.address);
  await acl.grantRole(await acl.AGENT_ROLE(), disputes.address);
  await acl.grantRole(await acl.REGISTRAR_ROLE(), admin);
  await acl.grantRole(await acl.SURVEYOR_ROLE(), surveyor);
  await acl.grantRole(await acl.LAWYER_ROLE(), lawyer);
  await acl.grantRole(await acl.ID_OFFICER_ROLE(), idOfficer);
  await acl.grantRole(await acl.JUDGE_ROLE(), judge);
  return { acl, identity, tghs, titles, market, disputes, registrar: admin, surveyor, lawyer, idOfficer, judge };
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
    acresX100: 620, lats, lngs,
    docs: [{ docType: "Indenture", name: `${parcelId}-indenture.pdf`, hash: web3.utils.soliditySha3(parcelId) }],
  };
}

/** Applies, then has surveyor, lawyer and registrar sign. Returns the record id of the new title. */
async function titledParcel(sys, owner, parcelId, offset) {
  await sys.titles.submitApplication(application(parcelId, offset), { from: owner });
  const appId = Number(await sys.titles.applicationCount());
  await sys.titles.approveSurvey(appId, { from: sys.surveyor });
  await sys.titles.approveLegal(appId, { from: sys.lawyer });
  await sys.titles.finalise(appId, { from: sys.registrar });
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

const cedis = (n) => web3.utils.toWei(String(n), "ether");

module.exports = { deploySystem, verifiedCitizen, application, titledParcel, expectRevert, cedis, cardHash, square };
