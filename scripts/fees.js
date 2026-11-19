// Fee schedule used for estimates in the seed (the web app has the same table in src/lib/landchain/fees.ts).
// Lands Commission figures as published in its fee schedule (reported by YEN.com.gh, Oct 2026);
// stamp duty bands from the Stamp Duty Act 2005 (Act 689) as amended by Act 1109 (in force 1 Jan 2024).
// Estimates only: always confirm with the Lands Commission and the GRA.
const KIND = { OfficialSearch: 0, StampDuty: 1, FirstRegistration: 2, Transfer: 3 };
const OFFICIAL_SEARCH = 163;
const FIRST_REGISTRATION_PER_ACRE = 1178; // GH¢ 1,148–1,178 per acre or part; upper figure used
const TRANSFER_PER_ACRE = 973;
const perAcre = (rate, acres) => rate * Math.max(1, Math.ceil(acres));
function stampDuty(consideration) {
  const rate = consideration <= 10000 ? 0.0025 : consideration < 50000 ? 0.005 : 0.01;
  return Math.round(consideration * rate);
}
const pesewas = (cedis) => Math.round(cedis * 100);
module.exports = { KIND, OFFICIAL_SEARCH, FIRST_REGISTRATION_PER_ACRE, TRANSFER_PER_ACRE, perAcre, stampDuty, pesewas };
