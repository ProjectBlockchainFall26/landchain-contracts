const { deploySystem, verifiedCitizen, application, expectRevert } = require("./helpers/setup");

contract("TitleRegistry: registration", (accounts) => {
  const ama = accounts[5], kofi = accounts[6];
  let sys;
  beforeEach(async () => {
    sys = await deploySystem(accounts);
    await verifiedCitizen(sys, ama, 1);
  });

  it("needs a verified identity to apply", async () => {
    await expectRevert(sys.titles.submitApplication(application("GA-BRK-0015"), { from: kofi }), "Verify your identity before registering land");
  });

  it("a pending application has a record but no token", async () => {
    await sys.titles.submitApplication(application("GA-BRK-0015"), { from: ama });
    const p = await sys.titles.getParcel(1);
    assert.equal(p.status, "0");
    assert.equal(p.tokenId, "0");
    assert.equal(p.owner, ama);
    assert.equal((await sys.titles.totalSupply()).toString(), "0");
  });

  it("steps go survey -> legal -> registrar, each by its own role, then the title is minted", async () => {
    await sys.titles.submitApplication(application("GA-BRK-0015"), { from: ama });
    await expectRevert(sys.titles.approveLegal(1, { from: sys.lawyer }), "Steps must happen in order");
    await expectRevert(sys.titles.approveSurvey(1, { from: sys.lawyer }), "Only the surveyor can sign this step");
    await sys.titles.approveSurvey(1, { from: sys.surveyor });
    await sys.titles.approveLegal(1, { from: sys.lawyer });
    await expectRevert(sys.titles.finalise(1, { from: sys.lawyer }), "Only the registrar can sign this step");
    const tx = await sys.titles.finalise(1, { from: sys.registrar });
    assert.equal(tx.logs.find((l) => l.event === "TitleMinted").args.tokenId.toString(), "1");
    assert.equal(await sys.titles.ownerOf(1), ama);
    assert.equal((await sys.titles.getParcel(1)).status, "1");
  });

  it("rejecting needs a reason and frees the parcel id for a corrected application", async () => {
    await sys.titles.submitApplication(application("GA-BRK-0015"), { from: ama });
    await expectRevert(sys.titles.rejectApplication(1, 0, "", { from: sys.surveyor }), "A reason is required to reject");
    await sys.titles.rejectApplication(1, 0, "Pillars missing", { from: sys.surveyor });
    assert.equal((await sys.titles.getParcel(1)).status, "6");
    await sys.titles.submitApplication(application("GA-BRK-0015"), { from: ama });
    assert.equal((await sys.titles.recordOfParcelId("GA-BRK-0015")).toString(), "2");
  });

  it("rejects bad ids, duplicate ids, duplicate boundaries and pillars outside Ghana", async () => {
    await expectRevert(sys.titles.submitApplication(application("GA-BRK-15"), { from: ama }), "Parcel ID must look like GA-BRK-0015");
    await sys.titles.submitApplication(application("GA-BRK-0015", 0), { from: ama });
    await expectRevert(sys.titles.submitApplication(application("GA-BRK-0015", 1), { from: ama }), "Parcel ID GA-BRK-0015 is already used");
    await expectRevert(sys.titles.submitApplication(application("GA-BRK-0016", 0), { from: ama }), "This boundary is already registered");
    const sea = application("GA-BRK-0017", 2);
    sea.lats = [3000000, 3000000, 3001000];
    sea.lngs = [0, 1000, 1000];
    await expectRevert(sys.titles.submitApplication(sea, { from: ama }), "All pillars must be inside Ghana");
    const two = application("GA-BRK-0018", 3);
    two.lats = two.lats.slice(0, 2); two.lngs = two.lngs.slice(0, 2);
    await expectRevert(sys.titles.submitApplication(two, { from: ama }), "A boundary needs at least 3 corner pillars");
  });

  it("stores the boundary and document hashes", async () => {
    const app = application("GA-BRK-0015");
    await sys.titles.submitApplication(app, { from: ama });
    const b = await sys.titles.getBoundary(1);
    assert.deepEqual(b.lats.map(String), app.lats.map(String));
    const docs = await sys.titles.getDocs(1);
    assert.equal(docs[0].hash, app.docs[0].hash);
  });
});
