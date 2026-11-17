// Deploys the six LandChain contracts, wires contract-to-contract permissions, grants officer roles
// and records the addresses for the front end (shared/deployments*.json).
const LandAccessControl = artifacts.require("LandAccessControl");
const IdentityRegistry = artifacts.require("IdentityRegistry");
const TestCedi = artifacts.require("TestCedi");
const TitleRegistry = artifacts.require("TitleRegistry");
const Marketplace = artifacts.require("Marketplace");
const DisputeResolution = artifacts.require("DisputeResolution");
const { recordDeployment } = require("../scripts/recordDeployment");

module.exports = async function (deployer, network, accounts) {
  const admin = accounts[0];
  const startBlock = await web3.eth.getBlockNumber();

  await deployer.deploy(LandAccessControl, admin);
  const acl = await LandAccessControl.deployed();
  await deployer.deploy(IdentityRegistry, acl.address);
  const identity = await IdentityRegistry.deployed();
  await deployer.deploy(TestCedi, acl.address);
  const tghs = await TestCedi.deployed();
  await deployer.deploy(TitleRegistry, acl.address, identity.address);
  const titles = await TitleRegistry.deployed();
  await deployer.deploy(Marketplace, acl.address, identity.address, titles.address, tghs.address);
  const market = await Marketplace.deployed();
  await deployer.deploy(DisputeResolution, acl.address, market.address, titles.address);
  const disputes = await DisputeResolution.deployed();

  // Only these two contracts may change a title's status or owner.
  const AGENT = await acl.AGENT_ROLE();
  await acl.grantRole(AGENT, market.address);
  await acl.grantRole(AGENT, disputes.address);

  // Officer roles. Local Ganache: one deterministic account per role (see README "Demo accounts").
  // Testnets: addresses from .env.local, falling back to the deployer.
  const local = network === "development" || network === "test";
  const pick = (envKey, i) => (local ? accounts[i] : process.env[envKey] || admin);
  const officers = {
    REGISTRAR_ROLE: pick("REGISTRAR", 0),
    SURVEYOR_ROLE: pick("SURVEYOR", 1),
    LAWYER_ROLE: pick("LAWYER", 2),
    ID_OFFICER_ROLE: pick("ID_OFFICER", 3),
    JUDGE_ROLE: pick("JUDGE", 4),
  };
  for (const [role, who] of Object.entries(officers)) {
    await acl.grantRole(await acl[role](), who);
  }

  // `truffle test` re-runs migrations on the dev chain; don't overwrite the addresses the web app uses.
  const runningTests = network === "test" || process.argv.slice(2).includes("test");
  if (runningTests) return;
  const chainId = Number(await web3.eth.getChainId());
  recordDeployment(chainId, network, startBlock, {
    LandAccessControl: acl.address,
    IdentityRegistry: identity.address,
    TestCedi: tghs.address,
    TitleRegistry: titles.address,
    Marketplace: market.address,
    DisputeResolution: disputes.address,
  });
};
