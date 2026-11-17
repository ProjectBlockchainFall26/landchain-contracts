// Writes deployed addresses by chain id. Local chains (1337) go to deployments.local.json (git-ignored,
// because they change on every fresh chain); testnets go to deployments.json (commit it).
const fs = require("fs");
const path = require("path");

function recordDeployment(chainId, network, startBlock, contracts) {
  const local = chainId === 1337 || chainId === 5777;
  const file = path.join(__dirname, "..", "shared", local ? "deployments.local.json" : "deployments.json");
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  all[chainId] = { network, startBlock: Number(startBlock), deployedAt: new Date().toISOString(), contracts };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + "\n");
  console.log(`\n  Recorded ${Object.keys(contracts).length} addresses for chain ${chainId} in ${path.relative(process.cwd(), file)}`);
}

module.exports = { recordDeployment };
