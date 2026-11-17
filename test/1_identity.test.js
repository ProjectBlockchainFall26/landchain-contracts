const { deploySystem, expectRevert, cardHash } = require("./helpers/setup");

contract("IdentityRegistry", (accounts) => {
  const ama = accounts[5], kofi = accounts[6];
  let sys;
  beforeEach(async () => { sys = await deploySystem(accounts); });

  it("stores only a card hash and moves pending -> verified after an identity officer signs", async () => {
    await sys.identity.submitProfile(cardHash(1), true, { from: ama });
    let p = await sys.identity.profileOf(ama);
    assert.equal(p.status, "1");
    assert.equal(p.cardHash, cardHash(1));
    await sys.identity.verifyProfile(ama, { from: sys.idOfficer });
    assert.isTrue(await sys.identity.isVerified(ama));
  });

  it("only an identity officer can verify", async () => {
    await sys.identity.submitProfile(cardHash(1), true, { from: ama });
    await expectRevert(sys.identity.verifyProfile(ama, { from: kofi }), "Only an identity officer can do this");
  });

  it("one Ghana Card cannot be linked to two wallets", async () => {
    await sys.identity.submitProfile(cardHash(1), true, { from: ama });
    await expectRevert(sys.identity.submitProfile(cardHash(1), true, { from: kofi }), "already linked to another profile");
  });

  it("officers cannot submit a citizen profile", async () => {
    await expectRevert(sys.identity.submitProfile(cardHash(1), true, { from: sys.surveyor }), "Only citizens can submit a profile");
  });

  it("a rejected person can resubmit with the same card", async () => {
    await sys.identity.submitProfile(cardHash(1), true, { from: ama });
    await sys.identity.rejectProfile(ama, { from: sys.idOfficer });
    await sys.identity.submitProfile(cardHash(1), true, { from: ama });
    assert.equal((await sys.identity.profileOf(ama)).status, "1");
  });
});
