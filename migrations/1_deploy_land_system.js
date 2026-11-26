// Deploys the five LandChain contracts, connects the fee ledger and the encumbrance registry, grants the Lands Commission roles and records the addresses for
// the front end (shared/deployments*.json).
const LandAccessControl = artifacts.require("LandAccessControl");
const IdentityRegistry = artifacts.require("IdentityRegistry");
const TitleRegistry = artifacts.require("TitleRegistry");
const FeeLedger = artifacts.require("FeeLedger");
const EncumbranceRegistry = artifacts.require("EncumbranceRegistry");
const { recordDeployment } = require("../scripts/recordDeployment");

module.exports = async function (deployer, network, accounts) {
  const admin = accounts[0];
  const startBlock = await web3.eth.getBlockNumber();

  await deployer.deploy(LandAccessControl, admin);
  const acl = await LandAccessControl.deployed();
  await deployer.deploy(IdentityRegistry, acl.address);
  const identity = await IdentityRegistry.deployed();
  await deployer.deploy(TitleRegistry, acl.address, identity.address);
  const titles = await TitleRegistry.deployed();
  await deployer.deploy(FeeLedger, acl.address, titles.address);
  const fees = await FeeLedger.deployed();
  // From now on the registrar can only approve once the fee receipts are recorded.
  await titles.setFeeLedger(fees.address);
  await deployer.deploy(EncumbranceRegistry, acl.address, titles.address);
  const encumbrances = await EncumbranceRegistry.deployed();
  // From now on an active mortgage, lien, caveat or court order blocks transfers.
  await titles.setEncumbranceRegistry(encumbrances.address);

  // Officer roles. Local Ganache: account 0 is the registrar, account 1 the identity officer
  // (see README "Demo accounts"). Testnets: addresses from .env.local, falling back to the deployer.
  const local = network === "development" || network === "test";
  const pick = (envKey, i) => (local ? accounts[i] : process.env[envKey] || admin);
  await acl.grantRole(await acl.REGISTRAR_ROLE(), pick("REGISTRAR", 0));
  await acl.grantRole(await acl.ID_OFFICER_ROLE(), pick("ID_OFFICER", 1));

  // `truffle test` re-runs migrations on the dev chain; don't overwrite the addresses the web app uses.
  const runningTests = network === "test" || process.argv.slice(2).includes("test");
  if (runningTests) return;
  const chainId = Number(await web3.eth.getChainId());
  recordDeployment(chainId, network, startBlock, {
    LandAccessControl: acl.address,
    IdentityRegistry: identity.address,
    TitleRegistry: titles.address,
    FeeLedger: fees.address,
    EncumbranceRegistry: encumbrances.address,
  });
};
