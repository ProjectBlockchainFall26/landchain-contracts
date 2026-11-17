const { deploySystem, expectRevert, cedis } = require("./helpers/setup");

contract("TestCedi", (accounts) => {
  const ama = accounts[5];
  let sys;
  beforeEach(async () => { sys = await deploySystem(accounts); });

  it("gives 1,000,000 tGHS once per hour to citizen wallets", async () => {
    await sys.tghs.faucet({ from: ama });
    assert.equal((await sys.tghs.balanceOf(ama)).toString(), cedis(1000000));
    await expectRevert(sys.tghs.faucet({ from: ama }), "Faucet already claimed");
  });

  it("officers cannot claim, and only the admin can mint", async () => {
    await expectRevert(sys.tghs.faucet({ from: sys.judge }), "Only citizen wallets can claim test cedis");
    await expectRevert(sys.tghs.mint(ama, 1, { from: ama }), "Only the admin can mint");
  });

  it("only agent contracts can change a title's status", async () => {
    await expectRevert(sys.titles.setStatus(1, 1, { from: sys.registrar }), "Only a Lands Commission contract can change a title");
  });
});
