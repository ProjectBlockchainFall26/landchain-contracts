const { deploySystem, verifiedCitizen, application, receipt, FEE, expectRevert } = require("./helpers/setup");

contract("FeeLedger: receipts the registrar records", (accounts) => {
  const ama = accounts[2];
  let sys;
  beforeEach(async () => {
    sys = await deploySystem(accounts);
    await verifiedCitizen(sys, ama, 1);
    await sys.titles.submitApplication(application("GA-BRK-0015"), { from: ama });
  });

  it("a registration can't be approved until stamp duty and the registration fee are recorded", async () => {
    await expectRevert(sys.titles.approveApplication(1, { from: sys.registrar }), "Record the stamp duty receipt before approving");
    await sys.fees.recordPayment(1, FEE.StampDuty, 60000, receipt(), { from: sys.registrar });
    await expectRevert(sys.titles.approveApplication(1, { from: sys.registrar }), "Record the registration fee before approving");
    await sys.fees.recordPayment(1, FEE.FirstRegistration, 117800, receipt(), { from: sys.registrar });
    await sys.titles.approveApplication(1, { from: sys.registrar });
  });

  it("only the registrar records payments, with an amount and a receipt number", async () => {
    await expectRevert(sys.fees.recordPayment(1, FEE.OfficialSearch, 16300, receipt(), { from: ama }), "Only the registrar can record a payment");
    await expectRevert(sys.fees.recordPayment(1, FEE.OfficialSearch, 0, receipt(), { from: sys.registrar }), "Amount must be greater than zero");
    await expectRevert(sys.fees.recordPayment(1, FEE.OfficialSearch, 16300, "0x" + "0".repeat(64), { from: sys.registrar }), "Add the official receipt number");
    await expectRevert(sys.fees.recordPayment(9, FEE.OfficialSearch, 16300, receipt(), { from: sys.registrar }), "Parcel does not exist");
  });

  it("a receipt number can't be used twice, and a fee can't be recorded twice", async () => {
    const r = receipt();
    await sys.fees.recordPayment(1, FEE.OfficialSearch, 16300, r, { from: sys.registrar });
    await expectRevert(sys.fees.recordPayment(1, FEE.StampDuty, 60000, r, { from: sys.registrar }), "This receipt has already been recorded");
    await expectRevert(sys.fees.recordPayment(1, FEE.OfficialSearch, 16300, receipt(), { from: sys.registrar }), "already recorded for the parcel");
  });

  it("stores who paid, how much and when", async () => {
    await sys.fees.recordPayment(1, FEE.OfficialSearch, 16300, receipt(), { from: sys.registrar });
    const p = await sys.fees.getPayment(1);
    assert.equal(p.payer, ama);
    assert.equal(p.amountPesewas, "16300");
    assert.equal(p.recordedBy, sys.registrar);
    assert.deepEqual((await sys.fees.paymentsOf(1)).map(String), ["1"]);
  });

  it("a transfer fee needs a transfer waiting for approval", async () => {
    await expectRevert(sys.fees.recordPayment(1, FEE.Transfer, 97300, receipt(), { from: sys.registrar }), "There is no transfer waiting");
  });

  it("the fee ledger can only be connected once, by the admin", async () => {
    await expectRevert(sys.titles.setFeeLedger(sys.fees.address, { from: sys.registrar }), "Fee ledger already set");
    await expectRevert(sys.titles.setFeeLedger(sys.fees.address, { from: ama }), "Only the admin can connect the fee ledger");
  });
});
