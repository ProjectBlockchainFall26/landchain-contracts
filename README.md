# LandChain Ghana: smart contracts

A blockchain land register for the Lands Commission of Ghana. The sale of land still happens off chain (indenture,
lawyer, family or stool). LandChain records the **result** so that nobody can quietly change it afterwards:

1. **Identity.** A person links their wallet to a Ghana Card. Only a hash of the card goes on chain. An identity
   officer verifies it.
2. **Register.** The verified owner applies with the parcel ID, the regional plan number, the GhanaPostGPS address,
   the GPS boundary and the SHA-256 fingerprints of the site plan, indenture and search report.
3. **Fees.** The owner pays the official fees in cedis as usual. The registrar records each receipt in `FeeLedger`
   (amount + hash of the receipt number). A receipt can't be recorded twice.
4. **Approve.** The Lands Commission registrar approves. The contract refuses until the stamp duty and registration
   fee are recorded, then mints the title as an **ERC-721 NFT** to the owner and the record is locked.
5. **Transfer.** To record a new owner, the owner requests a transfer, the registrar records the transfer fee and
   approves it. Neither can move a title alone. Every owner is kept on chain in `ownerHistory`.
6. **Verify.** Anyone can read any title, its boundary and its full history for free.

Toolchain, same as the course: **Truffle 5, Solidity 0.8.20 (EVM paris), OpenZeppelin 5.0.2, Ganache, web3.js v4.**

## Run the whole project

You need **Node.js 20+** and both repos cloned **side by side** in one folder:

```
ProjectBlockchain/
├─ landchain-contracts/
└─ landchain-web-main/     (the landchain-web repo)
```

The project runs in **three terminals**: the blockchain, the setup, and the web app.

### First time only

```bash
cd landchain-contracts && npm install
cd ../landchain-web-main && npm install
```

### Start everything from scratch (recommended before a demo)

```bash
# terminal 1, in landchain-contracts: stop any running chain (Ctrl+C), then
npm run chain:fresh          # empty local blockchain on 127.0.0.1:7545. Leave this running.

# terminal 2, in landchain-contracts (wait until terminal 1 says "RPC Listening on 127.0.0.1:7545")
npm run setup:local          # deploy the 4 contracts + seed the demo data. Wait for "Seeded."

# terminal 2 again, in landchain-web-main (only after "Seeded.")
npm run contracts:sync       # copy the new contract addresses and ABIs into the web app

# terminal 3, in landchain-web-main
npm run dev                  # open the URL it prints, usually http://localhost:5173
```

The two middle steps can be one command: `npm run setup:all` in `landchain-contracts` runs `setup:local`, then
`contracts:sync` in the web app, in the right order.

Then hard-refresh the browser (**Cmd+Shift+R**) and pick a demo account on the login page. No wallet is needed on
the local chain.

### Which chain command?

| Command | What happens when you stop it |
|---|---|
| `npm run chain:fresh` | Everything is lost. Run `setup:local` + `contracts:sync` again after every restart. Best for demos: a clean start every time. |
| `npm run chain` | Saved in `landchain-contracts/.ganache-db/`. Next time, just run `npm run chain` and `npm run dev`; no setup needed. |

### When to run setup again

- After `chain:fresh` (every time).
- After changing any contract in `contracts/`.
- After pulling contract changes from GitHub.
- When the app says "This chain doesn't have the current LandChain contracts".

### Troubleshooting

| You see | Do this |
|---|---|
| "Can't reach http://127.0.0.1:7545. Is the chain running?" | Start terminal 1 (`npm run chain:fresh` or `npm run chain`). |
| "This chain doesn't have the current LandChain contracts" / "No demo accounts found" | The web app has old addresses. Run `npm run setup:all` in `landchain-contracts`, then Cmd+Shift+R. |
| `contracts:sync` says "Synced 3 ABIs" | You synced before setup finished. Run `contracts:sync` again (it should say 4 ABIs). |
| "This version of µWS is not compatible with your Node.js build" | Harmless warning from Ganache on newer Node. Ignore it, or use Node 20. |
| Port 7545 already in use | Another chain is running (maybe the Ganache desktop app). Close it, or `lsof -i :7545` and stop that process. |
| MetaMask errors after a fresh chain | MetaMask → Settings → Advanced → Clear activity tab data. Network: RPC `http://127.0.0.1:7545`, chain ID `1337`. |

### Tests

```bash
# landchain-contracts, with a chain running
npm run contracts:test       # 25 Truffle tests

# landchain-web-main, with the seeded chain running
npm run test:e2e             # 5 end-to-end tests through the app's own functions
```

Running `contracts:test` doesn't touch your saved addresses. Running `setup:local` on a different chain does:
run `setup:all` on your own chain afterwards.

### Scripts

| Script | What it does |
|---|---|
| `npm run contracts:compile` | Compile and write `shared/abi/*.json` |
| `npm run contracts:test` | 25 tests: identity, registration, tamper-proof ownership, transfers and fee receipts (needs `npm run chain` running) |
| `npm run deploy:local` | Deploy to Ganache and record addresses in `shared/deployments.local.json` |
| `npm run seed:local` | Create the demo identities, parcels and transfers with real transactions |
| `npm run deploy:sepolia` | Deploy to Sepolia |

## Demo accounts (local chain)

| # | Name | Role |
|---|---|---|
| 0 | Lands Commission | Registrar + admin (deployer) |
| 1 | Abena Sarpong | Identity officer |
| 2–5 | Ama Owusu, Yaw Boakye, Kofi Mensah, Akosua Darko | Verified (Akosua non-citizen) |
| 6 | Kwabena Ofori | Identity pending |
| 7 | Efua Mensah | No profile yet (use her to demo the flow from scratch) |

Seed: 14 parcels around Berekuso, each with a plan number, GPS address, three document fingerprints and recorded
fees (search, stamp duty on an illustrative GH¢ 60,000/acre, registration, and transfer where relevant). 10 registered, GA-BRK-0001 and GA-BRK-0008 already transferred once,
GA-BRK-0006 with a transfer waiting for the registrar, GA-BRK-0013 and GA-BRK-0014 waiting for registration.

## Architecture

```
            LandAccessControl  (one role hub: admin, REGISTRAR_ROLE, ID_OFFICER_ROLE)
                    ▲  each contract inherits LandRoleGuard and asks the hub "does X hold role Y?"
          ┌─────────┴──────────┬───────────────────────┐
  IdentityRegistry ◄──── TitleRegistry (ERC-721 "GLT") ◄──► FeeLedger
   who is who:            apply → registrar approves → mint     registrar records official receipts;
   card hash, verified?   request → registrar approves → move   TitleRegistry won't approve without them
```

| Contract | Key functions |
|---|---|
| `LandAccessControl` | `grantRole`, `revokeRole`, `rolesOf`, `isOfficer` |
| `IdentityRegistry` | `submitProfile(cardHash, citizen)`, `verifyProfile`, `rejectProfile`, `profileOf`, `isVerified`, `members`, `publicIdOf` |
| `FeeLedger` | `recordPayment(recordId, kind, amountPesewas, receiptHash)`, `isPaid`, `transferFeePaid`, `getPayment`, `paymentsOf` |
| `TitleRegistry` | `setFeeLedger`, `submitApplication(tuple)`, `approveApplication`, `rejectApplication`, `requestTransfer`, `cancelTransfer`, `approveTransfer`, `rejectTransfer`, `getParcel`, `getBoundary`, `getDocs`, `ownerHistory`, `getApplication`, `getTransfer`, `recordOfParcelId` |

### Events (the audit trail)

`ProfileSubmitted`, `ProfileVerified`, `ProfileRejected`, `ApplicationSubmitted`, `ApplicationApproved`,
`ApplicationRejected`, `TitleMinted`, `PaymentRecorded`, `TransferRequested`, `TransferApproved`, `TransferRejected`, `TransferCancelled`,
plus the standard ERC-721 `Transfer`. The web app builds every title's history and the activity log from these.

### How the front end uses them

| Screen action | Contract call |
|---|---|
| Identity: submit Ghana Card | `IdentityRegistry.submitProfile(keccak256("landchain-card:" + card), citizen)` |
| Review queue: verify identity | `IdentityRegistry.verifyProfile(address)` |
| Register Land | `TitleRegistry.submitApplication({parcelId, interest, holder, region, location, planNumber, gpsAddress, acresX100, lats, lngs, docs: [{docType, hash}]})` |
| Review queue: record a fee receipt | `FeeLedger.recordPayment(recordId, kind, amountPesewas, keccak256(receiptNo))` |
| Review queue: approve registration | `TitleRegistry.approveApplication(appId)` (mints the NFT) |
| Title record: transfer ownership | `TitleRegistry.requestTransfer(recordId, newOwner)` |
| Review queue: approve transfer | `TitleRegistry.approveTransfer(transferId)` (moves the NFT) |

### Design decisions worth defending in the review

- **Tamper-proof ownership.** `_update` refuses any transfer that has a caller, so `transferFrom` and
  `safeTransferFrom` always revert, even for the owner. Only the contract's own `_mint` and `_transfer` (inside
  `approveTransfer`) can move a title.
- **Two keys to move a title.** The owner must request the transfer and the registrar must approve it. The registrar
  can't take a title the owner never offered, and the owner can't skip the Lands Commission.
- **Pending ≠ minted.** An application is a record with no token; the ERC-721 is minted only on approval.
- **One active record per parcel ID and per boundary.** Rejection frees both for a corrected application.
- **Coordinates in micro-degrees**, bounded to Ghana's box (Solidity has no decimals). Overlap between different
  polygons is checked in the web app before submitting.
- **Privacy: the chain is public.** Anything in a contract (even `private` variables) can be read by anyone running a
  node. So only a card hash, a pseudonymous public ID (`GH-` + 4 bytes of keccak256(address)), document *types and
  fingerprints* and receipt-number hashes go on chain. Names, files (and their file names), Ghana Card numbers and
  enquiry messages stay off chain with the Lands Commission. Anyone holding a copy of a document can prove it is the
  registered version by hashing it.
- **Fees on chain, money off chain.** Fees are paid in cedis outside the system; the registrar records each official
  receipt. Receipt numbers are hashed and can't be reused, and approval is blocked until the required fees exist.
  `FeeLedger` is a separate contract because `TitleRegistry` is close to Ethereum's 24 KB contract size limit.
- **Readable errors:** every `require` message is the sentence the UI shows.

## Assumptions

See the web app's **Assumptions** page (and `masterplan.md`). In short: the sale happens off the platform; the Lands
Commission is trusted when it enters a record (the chain stops later tampering, not a forgery that was approved);
physical and legal checks happen off chain; wallet = identity; no personal data on chain; fees paid in cedis off
chain; whole parcels only; courts decide disputes outside the system; one trusted registrar key; test network only.

## Not in this milestone

On-platform payments and escrow, disputes and court orders, leases and ground rent, succession, IPFS document storage,
the backend event indexer and backend-signed officer actions. Not audited: run Slither and a peer review before
anything beyond a testnet.
