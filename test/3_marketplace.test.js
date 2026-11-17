const { deploySystem, verifiedCitizen, titledParcel, expectRevert, cedis } = require("./helpers/setup");

contract("Marketplace: listing, escrow, registrar approval", (accounts) => {
  const ama = accounts[5], kofi = accounts[6];
  let sys, rec;
  beforeEach(async () => {
    sys = await deploySystem(accounts);
    await verifiedCitizen(sys, ama, 1);
    await verifiedCitizen(sys, kofi, 2);
    rec = await titledParcel(sys, ama, "GA-BRK-0015", 0);
    await sys.tghs.faucet({ from: kofi });
  });

  it("titles cannot be moved with transferFrom", async () => {
    await expectRevert(sys.titles.transferFrom(ama, kofi, 1, { from: ama }), "Titles move only through a Lands Commission approved sale");
  });

  it("only the owner can list, and only for a positive price", async () => {
    await expectRevert(sys.market.listForSale(rec, cedis(300000), { from: kofi }), "Only the owner can list this parcel");
    await expectRevert(sys.market.listForSale(rec, 0, { from: ama }), "Price must be greater than zero");
    await sys.market.listForSale(rec, cedis(300000), { from: ama });
    assert.equal((await sys.titles.getParcel(rec)).status, "2");
  });

  it("buying puts the money in escrow; registrar approval moves the title and pays the seller", async () => {
    await sys.market.listForSale(rec, cedis(300000), { from: ama });
    await sys.tghs.approve(sys.market.address, cedis(300000), { from: kofi });
    await sys.market.buyListed(rec, { from: kofi });
    assert.equal((await sys.titles.getParcel(rec)).status, "3");
    assert.equal((await sys.tghs.balanceOf(sys.market.address)).toString(), cedis(300000));

    await expectRevert(sys.market.approveSale(1, { from: kofi }), "Only the registrar can approve sales");
    await sys.market.approveSale(1, { from: sys.registrar });
    const p = await sys.titles.getParcel(rec);
    assert.equal(p.owner, kofi);
    assert.equal(p.status, "4");
    assert.equal(await sys.titles.ownerOf(p.tokenId), kofi);
    assert.equal((await sys.tghs.balanceOf(ama)).toString(), cedis(300000));
  });

  it("rejecting a sale refunds the buyer in full and unlists the parcel", async () => {
    await sys.market.listForSale(rec, cedis(300000), { from: ama });
    await sys.tghs.approve(sys.market.address, cedis(300000), { from: kofi });
    await sys.market.buyListed(rec, { from: kofi });
    await sys.market.rejectSale(1, { from: sys.registrar });
    assert.equal((await sys.tghs.balanceOf(kofi)).toString(), cedis(1000000));
    const p = await sys.titles.getParcel(rec);
    assert.equal(p.owner, ama);
    assert.equal(p.status, "1");
  });

  it("refuses unlisted parcels, own parcels, unverified buyers and buyers without enough tGHS", async () => {
    await expectRevert(sys.market.buyListed(rec, { from: kofi }), "Parcel is not for sale");
    await sys.market.listForSale(rec, cedis(2000000), { from: ama });
    await expectRevert(sys.market.buyListed(rec, { from: ama }), "You already own this parcel");
    await expectRevert(sys.market.buyListed(rec, { from: accounts[7] }), "Verify your identity before buying land");
    await expectRevert(sys.market.buyListed(rec, { from: kofi }), "Not enough tGHS");
  });

  it("cancelling a listing returns the title to not listed", async () => {
    await sys.market.listForSale(rec, cedis(300000), { from: ama });
    await sys.market.cancelListing(rec, { from: ama });
    assert.equal((await sys.titles.getParcel(rec)).status, "1");
    await expectRevert(sys.market.cancelListing(rec, { from: ama }), "Parcel is not listed");
  });
});
