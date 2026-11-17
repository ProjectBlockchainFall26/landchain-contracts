// Seeds a local chain with the same demo world the web app shows: verified citizens, 14 parcels around
// Berekuso in every state (titled, for sale, in escrow, sold, frozen, pending), a dispute and balances.
// Every step is a real transaction. Run after `npm run deploy:local`:  npm run seed:local
//
// Also writes shared/demo-accounts.local.json (address -> display name). Names never go on chain; the
// web app uses this file to label the deterministic Ganache accounts.
const fs = require("fs");
const path = require("path");

const LandAccessControl = artifacts.require("LandAccessControl");
const IdentityRegistry = artifacts.require("IdentityRegistry");
const TestCedi = artifacts.require("TestCedi");
const TitleRegistry = artifacts.require("TitleRegistry");
const Marketplace = artifacts.require("Marketplace");
const DisputeResolution = artifacts.require("DisputeResolution");

// ---- geometry (same as the web app's geo.ts) ----
const ORIGIN = [5.7505, -0.2275]; // Berekuso, Eastern Region
const M_PER_DEG_LAT = 110540;
const mPerDegLng = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const SQM_PER_ACRE = 4046.8564;
const unproject = ([x, y]) => [ORIGIN[0] - y / M_PER_DEG_LAT, ORIGIN[1] + x / mPerDegLng(ORIGIN[0])];
function makeQuad(cx, cy, acres, angleDeg, aspect = 1.2, skew = 0.08) {
  const area = acres * SQM_PER_ACRE;
  const w = Math.sqrt(area * aspect), h = area / w;
  const t = (angleDeg * Math.PI) / 180;
  const corners = [[-w / 2, -h / 2], [w / 2 + w * skew, -h / 2], [w / 2, h / 2], [-w / 2 - w * skew, h / 2]];
  return corners.map(([x, y]) => unproject([cx + x * Math.cos(t) - y * Math.sin(t), cy + x * Math.sin(t) + y * Math.cos(t)]));
}
const micro = (deg) => Math.round(deg * 1e6);

const INTEREST = { Allodial: 0, "Customary freehold": 1, "Common-law freehold": 2, Leasehold: 3 };

module.exports = async function (callback) {
  try {
    const accounts = await web3.eth.getAccounts();
    const [REGISTRAR, SURVEYOR, LAWYER, IDO, JUDGE, AMA, YAW, KOFI, AKOSUA, KWABENA, EFUA] = accounts;
    const names = [
      [REGISTRAR, "Lands Commission"], [SURVEYOR, "Kwame Asante"], [LAWYER, "Esi Quaye, Esq."],
      [IDO, "Abena Sarpong"], [JUDGE, "Justice Ansah"], [AMA, "Ama Owusu"], [YAW, "Yaw Boakye"],
      [KOFI, "Kofi Mensah"], [AKOSUA, "Akosua Darko"], [KWABENA, "Kwabena Ofori"], [EFUA, "Efua Mensah"],
    ];

    const acl = await LandAccessControl.deployed();
    const identity = await IdentityRegistry.deployed();
    const tghs = await TestCedi.deployed();
    const titles = await TitleRegistry.deployed();
    const market = await Marketplace.deployed();
    const disputes = await DisputeResolution.deployed();
    if (Number(await titles.parcelCount()) > 0) {
      console.log("Chain already has parcels; skipping seed. Run `npm run setup:local` on a fresh chain to reseed.");
      return callback();
    }
    void acl;
    const cedis = (n) => web3.utils.toWei(String(n), "ether");
    const card = (n) => web3.utils.soliditySha3(`landchain-card:GHA-70000000${n}-${n}`);
    let step = 0;
    const log = (msg) => console.log(`  ${String(++step).padStart(2)}. ${msg}`);

    // ---- identities ----
    const people = [[AMA, 1, true], [YAW, 2, true], [KOFI, 3, true], [AKOSUA, 4, false]];
    for (const [who, n, citizen] of people) {
      await identity.submitProfile(card(n), citizen, { from: who });
      await identity.verifyProfile(who, { from: IDO });
    }
    await identity.submitProfile(card(5), true, { from: KWABENA }); // left pending for the ID officer
    log("Identities: Ama, Yaw, Kofi, Akosua verified; Kwabena pending; Efua not submitted");

    // ---- balances ----
    for (const [who, amount] of [[AMA, 420000], [YAW, 360000], [KOFI, 811000]]) await tghs.mint(who, cedis(amount));
    await tghs.faucet({ from: AKOSUA });
    log("Balances minted (Akosua used the faucet)");

    // ---- parcels: id, owner, acres, interest, holder, status, cx, cy, angle, price ----
    const rows = [
      ["GA-BRK-0001", KOFI, 6.2, "Customary freehold", "Berekuso Stool", "sold", -620, 380, 8],
      ["GA-BRK-0002", AMA, 8.4, "Common-law freehold", "Owusu Family", "verified", -880, -60, -6],
      ["GA-BRK-0003", YAW, 15.36, "Customary freehold", "Agyeman Family", "for_sale", 230, -260, 12, 799000],
      ["GA-BRK-0004", KOFI, 7.1, "Customary freehold", "Berekuso Stool", "for_sale", 560, 330, -10, 300000],
      ["GA-BRK-0005", AMA, 9.1, "Customary freehold", "Berekuso Stool", "for_sale", -420, -480, 4, 386000],
      ["GA-BRK-0006", YAW, 8.3, "Allodial", "Agyeman Family", "in_escrow", 780, -620, 18, 399000],
      ["GA-BRK-0007", KOFI, 5.4, "Leasehold", "Berekuso Stool", "for_sale", -980, 520, -14, 240000],
      ["GA-BRK-0008", YAW, 3.9, "Common-law freehold", "Boakye Family", "sold", 960, 40, 6],
      ["GA-BRK-0009", AMA, 7.88, "Allodial", "Owusu Family", "verified", -120, 640, -4],
      ["GA-BRK-0010", AKOSUA, 6.6, "Customary freehold", "Berekuso Stool", "for_sale", 1180, 560, 10, 280000],
      ["GA-BRK-0011", KOFI, 10.2, "Customary freehold", "Mensah Family", "frozen", -1200, -560, 20],
      ["GA-BRK-0012", AMA, 4.92, "Leasehold", "Berekuso Stool", "in_escrow", -230, 80, 28, 275000],
      ["GA-BRK-0013", YAW, 5.8, "Customary freehold", "Berekuso Stool", "pending", -680, -360, -8],
      ["GA-BRK-0014", KOFI, 4.4, "Customary freehold", "Agyeman Family", "pending", 1240, -260, 4],
    ];

    const apply = async (i, [id, owner, acres, interest, holder, , cx, cy, angle]) => {
      const pts = makeQuad(cx, cy, acres, angle, 1.1 + (i % 3) * 0.15, (i % 4) * 0.05);
      await titles.submitApplication({
        parcelId: id, interest: INTEREST[interest], holder, region: "Eastern", location: "Berekuso, Eastern Region",
        acresX100: Math.round(acres * 100), lats: pts.map((p) => micro(p[0])), lngs: pts.map((p) => micro(p[1])),
        docs: [
          { docType: "Indenture", name: `${id}-indenture.pdf`, hash: web3.utils.sha3(`${id}-indenture`) },
          { docType: "Site plan", name: `${id}-site-plan.pdf`, hash: web3.utils.sha3(`${id}-site-plan`) },
        ],
      }, { from: owner });
      return { appId: Number(await titles.applicationCount()), recordId: Number(await titles.recordOfParcelId(id)) };
    };
    const signAll = async (appId) => {
      await titles.approveSurvey(appId, { from: SURVEYOR });
      await titles.approveLegal(appId, { from: LAWYER });
      await titles.finalise(appId, { from: REGISTRAR });
    };
    const buy = async (recordId, buyer, price) => {
      await tghs.approve(market.address, cedis(price), { from: buyer });
      await market.buyListed(recordId, { from: buyer });
      return Number(await market.saleCount());
    };

    for (const [i, row] of rows.entries()) {
      const [id, owner, , , , status, , , , price] = row;
      if (status === "pending") continue;
      // Sold parcels were first titled to the other party, then sold through escrow.
      const original = status === "sold" ? (owner === KOFI ? YAW : KOFI) : owner;
      const { appId, recordId } = await apply(i, [id, original, ...row.slice(2)]);
      await signAll(appId);
      if (status === "sold") {
        await market.listForSale(recordId, cedis(210000), { from: original });
        const sale = await buy(recordId, owner, 210000);
        await market.approveSale(sale, { from: REGISTRAR });
      } else if (status === "frozen") {
        await disputes.freezeTitle(recordId, "Boundary case, High Court suit LD/0412/2026", { from: JUDGE });
      } else if (status === "for_sale" || status === "in_escrow") {
        await market.listForSale(recordId, cedis(price), { from: owner });
      }
      log(`${id} titled${status === "verified" ? "" : `, ${status.replace("_", " ")}`}`);
    }

    // ---- escrow and a dispute ----
    await buy(Number(await titles.recordOfParcelId("GA-BRK-0012")), AKOSUA, 275000);
    log("Akosua paid GH₵ 275,000 into escrow for GA-BRK-0012 (awaiting registrar)");
    const sale2 = await buy(Number(await titles.recordOfParcelId("GA-BRK-0006")), KOFI, 399000);
    await disputes.raiseDispute(sale2, "Boundary pillars on site differ from the site plan", web3.utils.sha3("evidence"), { from: KOFI });
    log("Kofi bought GA-BRK-0006 and raised a dispute (waiting for the judge)");

    // ---- pending applications ----
    const p13 = await apply(12, rows[12]);
    await titles.approveSurvey(p13.appId, { from: SURVEYOR });
    await apply(13, rows[13]);
    log("GA-BRK-0013 (survey approved) and GA-BRK-0014 (new) pending");

    const file = path.join(__dirname, "..", "shared", "demo-accounts.local.json");
    fs.writeFileSync(file, JSON.stringify(names.map(([address, name]) => ({ address, name })), null, 2) + "\n");
    console.log(`\nSeeded. Labels for the demo accounts written to ${path.relative(process.cwd(), file)}`);
    callback();
  } catch (e) {
    callback(e);
  }
};
