// Copies just the ABI of each LandChain contract into shared/abi/<Name>.json for the front end and backend.
const fs = require("fs");
const path = require("path");

const NAMES = ["LandAccessControl", "IdentityRegistry", "TestCedi", "TitleRegistry", "Marketplace", "DisputeResolution"];
const out = path.join(__dirname, "..", "shared", "abi");
fs.mkdirSync(out, { recursive: true });
for (const name of NAMES) {
  const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "build", "contracts", `${name}.json`), "utf8"));
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(artifact.abi, null, 2) + "\n");
}
console.log(`Exported ${NAMES.length} ABIs to shared/abi/`);
