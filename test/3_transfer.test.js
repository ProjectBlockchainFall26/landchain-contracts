const { deploySystem, verifiedCitizen, titledParcel, receipt, FEE, expectRevert, STATUS, DECISION } = require("./helpers/setup");

contract("TitleRegistry: tamper-proof ownership and transfers", (accounts) => {
  const ama = accounts[2], kofi = accounts[3], yaw = accounts[4], stranger = accounts[7];
  let sys, rec;
  beforeEach(async () => {
    sys = await deploySystem(accounts);
    await verifiedCitizen(sys, ama, 1);
    await verifiedCitizen(sys, kofi, 2);
    rec = await titledParcel(sys, ama, "GA-BRK-0015", 0);
  });

  it("nobody can move a title with transferFrom, not even the owner", async () => {
    await expectRevert(sys.titles.transferFrom(ama, kofi, 1, { from: ama }), "Titles move only through a registrar-approved transfer");
    await sys.titles.approve(kofi, 1, { from: ama }).catch(() => {}); // approvals don't help either
    await expectRevert(sys.titles.transferFrom(ama, kofi, 1, { from: kofi }), "Titles move only through a registrar-approved transfer");
    assert.equal(await sys.titles.ownerOf(1), ama);
  });

  it("only the owner can request a transfer, and only to a verified person", async () => {
    await expectRevert(sys.titles.requestTransfer(rec, kofi, { from: kofi }), "Only the owner can transfer this title");
    await expectRevert(sys.titles.requestTransfer(rec, stranger, { from: ama }), "The new owner must have a verified identity");
    await expectRevert(sys.titles.requestTransfer(rec, ama, { from: ama }), "You already own this title");
  });

  it("owner requests, registrar approves: the NFT moves and the owner history grows", async () => {
    await sys.titles.requestTransfer(rec, kofi, { from: ama });
    assert.equal((await sys.titles.getParcel(rec)).status, STATUS.TransferPending);
    assert.equal(await sys.titles.ownerOf(1), ama); // nothing moves until the registrar signs
    await expectRevert(sys.titles.requestTransfer(rec, kofi, { from: ama }), "no pending transfer");
    await expectRevert(sys.titles.approveTransfer(1, { from: ama }), "Only the registrar can approve a transfer");
    await expectRevert(sys.titles.approveTransfer(1, { from: sys.registrar }), "Record the transfer fee before approving");
    await sys.fees.recordPayment(rec, FEE.Transfer, 97300, receipt(), { from: sys.registrar });

    const tx = await sys.titles.approveTransfer(1, { from: sys.registrar });
    assert.ok(tx.logs.find((l) => l.event === "TransferApproved"));
    assert.equal(await sys.titles.ownerOf(1), kofi);
    const p = await sys.titles.getParcel(rec);
    assert.equal(p.owner, kofi);
    assert.equal(p.status, STATUS.Registered);
    assert.deepEqual(await sys.titles.ownerHistory(rec), [ama, kofi]);
    assert.equal((await sys.titles.getTransfer(1)).decision, DECISION.Approved);
  });

  it("the registrar cannot move a title the owner never asked to transfer", async () => {
    await expectRevert(sys.titles.approveTransfer(1, { from: sys.registrar }), "Transfer not found");
  });

  it("a rejected or cancelled transfer leaves the owner unchanged", async () => {
    await sys.titles.requestTransfer(rec, kofi, { from: ama });
    await expectRevert(sys.titles.rejectTransfer(1, "", { from: sys.registrar }), "A reason is required to reject");
    await sys.titles.rejectTransfer(1, "No signed indenture", { from: sys.registrar });
    await expectRevert(sys.titles.approveTransfer(1, { from: sys.registrar }), "already been decided");

    await sys.titles.requestTransfer(rec, kofi, { from: ama });
    await expectRevert(sys.titles.cancelTransfer(2, { from: kofi }), "Only the owner who asked can cancel");
    await sys.titles.cancelTransfer(2, { from: ama });
    assert.equal(await sys.titles.ownerOf(1), ama);
    assert.equal((await sys.titles.getParcel(rec)).status, STATUS.Registered);
    assert.deepEqual(await sys.titles.ownerHistory(rec), [ama]);
  });

  it("a pending application cannot be transferred", async () => {
    await verifiedCitizen(sys, yaw, 3);
    await sys.titles.submitApplication(require("./helpers/setup").application("GA-BRK-0016", 1), { from: yaw });
    const pending = Number(await sys.titles.recordOfParcelId("GA-BRK-0016"));
    await expectRevert(sys.titles.requestTransfer(pending, kofi, { from: yaw }), "Only a registered title");
  });
});
