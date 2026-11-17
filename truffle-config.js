require("dotenv").config({ path: ".env.local" });
const HDWalletProvider = require("@truffle/hdwallet-provider");

module.exports = {
  networks: {
    // Local Ganache: `npm run chain` (port 7545, chain id 1337, deterministic accounts)
    development: { host: "127.0.0.1", port: 7545, network_id: "*" },
    // Ethereum Sepolia testnet. Put a THROWAWAY wallet's key in .env.local
    sepolia: {
      provider: () => new HDWalletProvider({ privateKeys: [process.env.TESTNET_PRIVATE_KEY], providerOrUrl: process.env.SEPOLIA_RPC_URL }),
      network_id: 11155111,
      confirmations: 1,
      timeoutBlocks: 200,
      skipDryRun: true,
    },
  },
  compilers: {
    solc: {
      // Pinned solc 0.8.20 from node_modules: no compiler download, works offline and behind firewalls.
      version: "./node_modules/solc",
      settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", viaIR: true },
    },
  },
};
