// Seeds a local chain with a small demo world: verified citizens, 14 registered or pending parcels around
// Berekuso, two completed ownership transfers and one waiting for the registrar.
// Every step is a real transaction. Run after `npm run deploy:local`:  npm run seed:local
//
// Also writes shared/demo-accounts.local.json (address -> display name). Names never go on chain; the
// web app uses this file to label the deterministic Ganache accounts.
const fs = require("fs");
const path = require("path");

const IdentityRegistry = artifacts.require("IdentityRegistry");
const TitleRegistry = artifacts.require("TitleRegistry");
const FeeLedger = artifacts.require("FeeLedger");
const F = require("./fees");

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
    const [REGISTRAR, IDO, AMA, YAW, KOFI, AKOSUA, KWABENA, EFUA] = accounts;
    const names = [
      [REGISTRAR, "Lands Commission"], [IDO, "Abena Sarpong"], [AMA, "Ama Owusu"], [YAW, "Yaw Boakye"],
      [KOFI, "Kofi Mensah"], [AKOSUA, "Akosua Darko"], [KWABENA, "Kwabena Ofori"], [EFUA, "Efua Mensah"],
    ];

    const identity = await IdentityRegistry.deployed();
    const titles = await TitleRegistry.deployed();
    const fees = await FeeLedger.deployed();
    let receiptNo = 4100;
    // The registrar records an official receipt (amount in GH¢, receipt number hashed).
    const pay = (recordId, kind, cedis) =>
      fees.recordPayment(recordId, kind, F.pesewas(cedis), web3.utils.soliditySha3(`LC/RCPT/2026/${++receiptNo}`), { from: REGISTRAR });
    if (Number(await titles.parcelCount()) > 0) {
      console.log("Chain already has parcels; skipping seed. Run `npm run setup:local` on a fresh chain to reseed.");
      return callback();
    }
    const card = (n) => web3.utils.soliditySha3(`landchain-card:GHA-70000000${n}-${n}`);
    let step = 0;
    const log = (msg) => console.log(`  ${String(++step).padStart(2)}. ${msg}`);

    // ---- identities ----
    const people = [[AMA, 1, true], [YAW, 2, true], [KOFI, 3, true], [AKOSUA, 4, false]];
    for (const [who, n, citizen] of people) {
      await identity.submitProfile(card(n), citizen, { from: who });
      await identity.verifyProfile(who, { from: IDO });
    }
    await identity.submitProfile(card(5), true, { from: KWABENA }); // left pending for the identity officer
    log("Identities: Ama, Yaw, Kofi, Akosua verified; Kwabena pending; Efua not submitted");

    // ---- parcels: id, owner, acres, interest, holder, status, cx, cy, angle, [transfer to] ----
    const rows = [
      ["GA-BRK-0001", YAW, 6.2, "Customary freehold", "Berekuso Stool", "transferred", -620, 380, 8, KOFI],
      ["GA-BRK-0002", AMA, 8.4, "Common-law freehold", "Owusu Family", "registered", -880, -60, -6],
      ["GA-BRK-0003", YAW, 15.36, "Customary freehold", "Agyeman Family", "registered", 230, -260, 12],
      ["GA-BRK-0004", KOFI, 7.1, "Customary freehold", "Berekuso Stool", "registered", 560, 330, -10],
      ["GA-BRK-0005", AMA, 9.1, "Customary freehold", "Berekuso Stool", "registered", -420, -480, 4],
      ["GA-BRK-0006", YAW, 8.3, "Allodial", "Agyeman Family", "transfer_pending", 780, -620, 18, KOFI],
      ["GA-BRK-0007", KOFI, 5.4, "Leasehold", "Berekuso Stool", "registered", -980, 520, -14],
      ["GA-BRK-0008", KOFI, 3.9, "Common-law freehold", "Boakye Family", "transferred", 960, 40, 6, YAW],
      ["GA-BRK-0009", AMA, 7.88, "Allodial", "Owusu Family", "registered", -120, 640, -4],
      ["GA-BRK-0010", AKOSUA, 6.6, "Customary freehold", "Berekuso Stool", "registered", 1180, 560, 10],
      ["GA-BRK-0011", KOFI, 10.2, "Customary freehold", "Mensah Family", "registered", -1200, -560, 20],
      ["GA-BRK-0012", AMA, 4.92, "Leasehold", "Berekuso Stool", "registered", -230, 80, 28],
      ["GA-BRK-0013", YAW, 5.8, "Customary freehold", "Berekuso Stool", "pending", -680, -360, -8],
      ["GA-BRK-0014", KOFI, 4.4, "Customary freehold", "Agyeman Family", "pending", 1240, -260, 4],
    ];
    const label = new Map(names);

    for (const [i, [id, owner, acres, interest, holder, status, cx, cy, angle, to]] of rows.entries()) {
      const pts = makeQuad(cx, cy, acres, angle, 1.1 + (i % 3) * 0.15, (i % 4) * 0.05);
      const n = id.slice(-4);
      await titles.submitApplication({
        parcelId: id, interest: INTEREST[interest], holder, region: "Eastern", location: "Berekuso, Eastern Region",
        planNumber: `SER B${4100 + Number(n)}/26`, gpsAddress: `EA-${String(1700 + Number(n) * 7)}-${String(5600 + Number(n) * 13).padStart(4, "0")}`,
        acresX100: Math.round(acres * 100), lats: pts.map((p) => micro(p[0])), lngs: pts.map((p) => micro(p[1])),
        // Only the type and fingerprint go on chain; the files stay with the Lands Commission.
        docs: [
          { docType: "Site plan", hash: web3.utils.sha3(`${id}-site-plan`) },
          { docType: "Indenture", hash: web3.utils.sha3(`${id}-indenture`) },
          { docType: "Search report", hash: web3.utils.sha3(`${id}-search-report`) },
        ],
      }, { from: owner });
      const recordId = Number(await titles.recordOfParcelId(id));
      // Declared consideration for stamp duty: an illustrative GH¢ 60,000 per acre.
      await pay(recordId, F.KIND.OfficialSearch, F.OFFICIAL_SEARCH);
      if (status === "pending") { log(`${id} applied by ${label.get(owner)}, waiting for the registrar`); continue; }
      await pay(recordId, F.KIND.StampDuty, F.stampDuty(Math.round(acres * 60000)));
      await pay(recordId, F.KIND.FirstRegistration, F.perAcre(F.FIRST_REGISTRATION_PER_ACRE, acres));
      await titles.approveApplication(Number(await titles.applicationCount()), { from: REGISTRAR });
      if (to) {
        await titles.requestTransfer(recordId, to, { from: owner });
        if (status === "transferred") {
          await pay(recordId, F.KIND.Transfer, F.perAcre(F.TRANSFER_PER_ACRE, acres));
          await titles.approveTransfer(Number(await titles.transferCount()), { from: REGISTRAR });
        }
      }
      const extra = status === "transferred" ? `, transferred to ${label.get(to)}`
        : status === "transfer_pending" ? `, transfer to ${label.get(to)} waiting for the registrar` : "";
      log(`${id} registered to ${label.get(owner)}${extra}`);
    }

    const file = path.join(__dirname, "..", "shared", "demo-accounts.local.json");
    fs.writeFileSync(file, JSON.stringify(names.map(([address, name]) => ({ address, name })), null, 2) + "\n");
    console.log(`\nSeeded. Labels for the demo accounts written to ${path.relative(process.cwd(), file)}`);
    void EFUA;
    callback();
  } catch (e) {
    callback(e);
  }
};
