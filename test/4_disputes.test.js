const { deploySystem, verifiedCitizen, titledParcel, expectRevert, cedis } = require("./helpers/setup");

contract("DisputeResolution", (accounts) => {
  const ama = accounts[5], kofi = accounts[6], yaw = accounts[7];
  let sys, rec;
  beforeEach(async () => {
    sys = await deploySystem(accounts);
    await verifiedCitizen(sys, ama, 1);
    await verifiedCitizen(sys, kofi, 2);
    rec = await titledParcel(sys, ama, "GA-BRK-0015", 0);
    await sys.tghs.faucet({ from: kofi });
    await sys.market.listForSale(rec, cedis(400000), { from: ama });
    await sys.tghs.approve(sys.market.address, cedis(400000), { from: kofi });
    await sys.market.buyListed(rec, { from: kofi });
  });

  it("only the buyer or seller can raise a dispute, with a reason", async () => {
    await expectRevert(sys.disputes.raiseDispute(1, "x", "0x" + "0".repeat(64), { from: yaw }), "Only the buyer or seller can raise a dispute");
    await expectRevert(sys.disputes.raiseDispute(1, "", "0x" + "0".repeat(64), { from: kofi }), "Give a reason for the dispute");
    await sys.disputes.raiseDispute(1, "Boundary differs", "0x" + "1".repeat(64), { from: kofi });
    assert.equal((await sys.market.getSale(1)).status, "3");
    await expectRevert(sys.market.approveSale(1, { from: sys.registrar }), "Sale is not awaiting approval");
  });

  it("a judge ruling for the buyer refunds; for the seller completes the sale", async () => {
    await sys.disputes.raiseDispute(1, "Boundary differs", "0x" + "1".repeat(64), { from: kofi });
    await expectRevert(sys.disputes.resolveDispute(1, false, { from: sys.registrar }), "Only a judge can resolve disputes");
    await sys.disputes.resolveDispute(1, false, { from: sys.judge });
    assert.equal((await sys.tghs.balanceOf(kofi)).toString(), cedis(1000000));
    assert.equal((await sys.titles.getParcel(rec)).owner, ama);
    await expectRevert(sys.disputes.resolveDispute(1, true, { from: sys.judge }), "Dispute not open");
  });

  it("ruling for the seller moves the title", async () => {
    await sys.disputes.raiseDispute(1, "Buyer wants out", "0x" + "1".repeat(64), { from: ama });
    await sys.disputes.resolveDispute(1, true, { from: sys.judge });
    assert.equal((await sys.titles.getParcel(rec)).owner, kofi);
    assert.equal((await sys.tghs.balanceOf(ama)).toString(), cedis(400000));
  });

  it("a judge can freeze and unfreeze a title, but not one in escrow", async () => {
    await expectRevert(sys.disputes.freezeTitle(rec, "Suit 12/2026", { from: sys.judge }), "Only a titled parcel that is not listed or in escrow can be frozen");
    await sys.market.rejectSale(1, { from: sys.registrar });
    await sys.disputes.freezeTitle(rec, "Suit 12/2026", { from: sys.judge });
    assert.equal((await sys.titles.getParcel(rec)).status, "5");
    await expectRevert(sys.market.listForSale(rec, cedis(1), { from: ama }), "Only verified titles");
    await sys.disputes.unfreezeTitle(rec, { from: sys.judge });
    assert.equal((await sys.titles.getParcel(rec)).status, "1");
  });
});
