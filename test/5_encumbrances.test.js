const { deploySystem, verifiedCitizen, titledParcel, application, receipt, FEE, expectRevert, STATUS, ENCUMBRANCE } = require("./helpers/setup");

contract("EncumbranceRegistry: mortgages, liens, caveats and court orders block a sale", (accounts) => {
  const ama = accounts[2], kofi = accounts[3], stranger = accounts[7];
  const deed = web3.utils.soliditySha3("mortgage-deed.pdf");
  let sys, rec;
  beforeEach(async () => {
    sys = await deploySystem(accounts);
    await verifiedCitizen(sys, ama, 1);
    await verifiedCitizen(sys, kofi, 2);
    rec = await titledParcel(sys, ama, "GA-BRK-0015", 0);
  });

  it("only the registrar can record or release an encumbrance", async () => {
    await expectRevert(
      sys.encumbrances.registerEncumbrance(rec, ENCUMBRANCE.Mortgage, "GCB/2026/0041", deed, { from: ama }),
      "Only the registrar can record an encumbrance",
    );
    await sys.encumbrances.registerEncumbrance(rec, ENCUMBRANCE.Mortgage, "GCB/2026/0041", deed, { from: sys.registrar });
    await expectRevert(sys.encumbrances.releaseEncumbrance(1, "Paid", { from: stranger }), "Only the registrar can release an encumbrance");
  });

  it("needs a registered title and an official reference", async () => {
    await expectRevert(sys.encumbrances.registerEncumbrance(99, ENCUMBRANCE.Lien, "X", deed, { from: sys.registrar }), "Parcel does not exist");
    await sys.titles.submitApplication(application("GA-BRK-0016", 1), { from: kofi });
    const pending = Number(await sys.titles.recordOfParcelId("GA-BRK-0016"));
    await expectRevert(
      sys.encumbrances.registerEncumbrance(pending, ENCUMBRANCE.Caveat, "CAV/1", deed, { from: sys.registrar }),
      "Only a registered title can carry an encumbrance",
    );
    await expectRevert(sys.encumbrances.registerEncumbrance(rec, ENCUMBRANCE.Lien, "", deed, { from: sys.registrar }), "Add the official reference");
  });

  it("an active mortgage stops the owner from starting a sale, until it is released", async () => {
    const tx = await sys.encumbrances.registerEncumbrance(rec, ENCUMBRANCE.Mortgage, "GCB/2026/0041", deed, { from: sys.registrar });
    assert.ok(tx.logs.find((l) => l.event === "EncumbranceRegistered"));
    assert.equal(Number(await sys.encumbrances.blockingCount(rec)), 1);
    await expectRevert(sys.titles.requestTransfer(rec, kofi, { from: ama }), "active mortgage, lien, caveat or court order");

    await expectRevert(sys.encumbrances.releaseEncumbrance(1, "", { from: sys.registrar }), "Say why it is released");
    await sys.encumbrances.releaseEncumbrance(1, "Loan repaid", { from: sys.registrar });
    await expectRevert(sys.encumbrances.releaseEncumbrance(1, "Again", { from: sys.registrar }), "already been released");
    const e = await sys.encumbrances.getEncumbrance(1);
    assert.equal(e.active, false);
    assert.equal(e.releaseNote, "Loan repaid");
    assert.equal(Number(await sys.encumbrances.blockingCount(rec)), 0);
    await sys.titles.requestTransfer(rec, kofi, { from: ama });
    assert.equal((await sys.titles.getParcel(rec)).status, STATUS.TransferPending);
  });

  it("a caveat lodged during a pending sale stops the registrar approving it", async () => {
    await sys.titles.requestTransfer(rec, kofi, { from: ama });
    await sys.fees.recordPayment(rec, FEE.Transfer, 97300, receipt(), { from: sys.registrar });
    await sys.encumbrances.registerEncumbrance(rec, ENCUMBRANCE.Caveat, "CAV/2026/0007", deed, { from: sys.registrar });
    await expectRevert(sys.titles.approveTransfer(1, { from: sys.registrar }), "active mortgage, lien, caveat or court order");
    assert.equal(await sys.titles.ownerOf(1), ama);
    await sys.encumbrances.releaseEncumbrance(1, "Caveat withdrawn", { from: sys.registrar });
    await sys.titles.approveTransfer(1, { from: sys.registrar });
    assert.equal(await sys.titles.ownerOf(1), kofi);
  });

  it("a lease is on record for buyers but doesn't block a sale", async () => {
    await sys.encumbrances.registerEncumbrance(rec, ENCUMBRANCE.Lease, "Lease LS/2026/12, 25 years", deed, { from: sys.registrar });
    assert.equal(Number(await sys.encumbrances.blockingCount(rec)), 0);
    assert.deepEqual((await sys.encumbrances.encumbrancesOf(rec)).map(Number), [1]);
    await sys.titles.requestTransfer(rec, kofi, { from: ama });
  });

  it("two claims both have to go before a sale", async () => {
    await sys.encumbrances.registerEncumbrance(rec, ENCUMBRANCE.Mortgage, "GCB/2026/0041", deed, { from: sys.registrar });
    await sys.encumbrances.registerEncumbrance(rec, ENCUMBRANCE.CourtOrder, "Suit LD/0123/2026", deed, { from: sys.registrar });
    await sys.encumbrances.releaseEncumbrance(1, "Loan repaid", { from: sys.registrar });
    await expectRevert(sys.titles.requestTransfer(rec, kofi, { from: ama }), "active mortgage");
    await sys.encumbrances.releaseEncumbrance(2, "Case struck out", { from: sys.registrar });
    await sys.titles.requestTransfer(rec, kofi, { from: ama });
  });

  it("the encumbrance registry can be connected only once, by the admin", async () => {
    await expectRevert(sys.titles.setEncumbranceRegistry(stranger, { from: ama }), "Only the admin");
    await expectRevert(sys.titles.setEncumbranceRegistry(stranger, { from: sys.registrar }), "already set");
  });
});
