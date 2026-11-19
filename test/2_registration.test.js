const { deploySystem, verifiedCitizen, application, payRegistrationFees, expectRevert, STATUS, DECISION } = require("./helpers/setup");

contract("TitleRegistry: registration", (accounts) => {
  const ama = accounts[2], kofi = accounts[3];
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
    assert.equal(p.status, STATUS.Pending);
    assert.equal(p.tokenId, "0");
    assert.equal(p.owner, ama);
    assert.equal((await sys.titles.totalSupply()).toString(), "0");
  });

  it("only the registrar can approve; approval mints the title NFT to the owner", async () => {
    await sys.titles.submitApplication(application("GA-BRK-0015"), { from: ama });
    await expectRevert(sys.titles.approveApplication(1, { from: ama }), "Only the registrar can approve a registration");
    await expectRevert(sys.titles.approveApplication(1, { from: sys.idOfficer }), "Only the registrar can approve a registration");
    await payRegistrationFees(sys, 1);
    const tx = await sys.titles.approveApplication(1, { from: sys.registrar });
    assert.equal(tx.logs.find((l) => l.event === "TitleMinted").args.tokenId.toString(), "1");
    assert.equal(await sys.titles.ownerOf(1), ama);
    const p = await sys.titles.getParcel(1);
    assert.equal(p.status, STATUS.Registered);
    assert.notEqual(p.registeredAt, "0");
    assert.deepEqual(await sys.titles.ownerHistory(1), [ama]);
    assert.equal((await sys.titles.getApplication(1)).decision, DECISION.Approved);
  });

  it("an application can only be decided once", async () => {
    await sys.titles.submitApplication(application("GA-BRK-0015"), { from: ama });
    await payRegistrationFees(sys, 1);
    await sys.titles.approveApplication(1, { from: sys.registrar });
    await expectRevert(sys.titles.approveApplication(1, { from: sys.registrar }), "already been decided");
    await expectRevert(sys.titles.rejectApplication(1, "Changed my mind", { from: sys.registrar }), "already been decided");
  });

  it("rejecting needs a reason and frees the parcel id for a corrected application", async () => {
    await sys.titles.submitApplication(application("GA-BRK-0015"), { from: ama });
    await expectRevert(sys.titles.rejectApplication(1, "", { from: sys.registrar }), "A reason is required to reject");
    await sys.titles.rejectApplication(1, "Site plan does not match the pillars", { from: sys.registrar });
    assert.equal((await sys.titles.getParcel(1)).status, STATUS.Rejected);
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

  it("needs the plan number from the site plan", async () => {
    const app = application("GA-BRK-0015");
    app.planNumber = "";
    await expectRevert(sys.titles.submitApplication(app, { from: ama }), "Add the regional plan number from the site plan");
  });

  it("stores the boundary and document hashes", async () => {
    const app = application("GA-BRK-0015");
    await sys.titles.submitApplication(app, { from: ama });
    const b = await sys.titles.getBoundary(1);
    assert.deepEqual(b.lats.map(String), app.lats.map(String));
    const docs = await sys.titles.getDocs(1);
    assert.equal(docs[0].hash, app.docs[0].hash);
    assert.equal(docs[0].docType, "Indenture");
    assert.equal((await sys.titles.getParcel(1)).planNumber, app.planNumber);
  });
});
