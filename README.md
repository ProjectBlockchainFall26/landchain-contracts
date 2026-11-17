# LandChain Ghana: smart contracts

A blockchain land-titling system for the Lands Commission of Ghana. Every registered parcel is an ERC-721 title
linked to its GPS boundary. Registration needs surveyor, lawyer and registrar sign-off, in that order. Sales settle
through escrow in test cedis (tGHS) and need the registrar's approval; a buyer or seller can take an escrowed sale to a
judge instead.

The contracts were designed to fit the web app ([landchain-web](https://github.com/ProjectBlockchainFall26/landchain-web)):
same contract names, same functions, same error messages. The web app reads and writes them directly.

Toolchain, same as the course: **Truffle 5, Solidity 0.8.20 (EVM paris), OpenZeppelin 5.0.2, Ganache, web3.js v4.**

## Quick start (local chain)

```bash
npm install
npm run chain          # terminal 1: Ganache on 127.0.0.1:7545, chain id 1337. Leave it running.
npm run setup:local    # terminal 2: deploy the 6 contracts, wire roles, seed the demo world
```

Then in the web app folder: `npm run contracts:sync` (copies ABIs + addresses) and `npm run dev`.

`npm run chain` keeps its data in `.ganache-db/`, so stopping and restarting it keeps your parcels. To start over,
delete `.ganache-db/` (or use `npm run chain:fresh`, which keeps nothing), then run `npm run setup:local` again and
`npm run contracts:sync` in the web app.

| Script | What it does |
|---|---|
| `npm run contracts:compile` | Compile and write `shared/abi/*.json` |
| `npm run contracts:test` | 24 tests, one file per flow (needs `npm run chain` running) |
| `npm run deploy:local` | Deploy to Ganache and record addresses in `shared/deployments.local.json` |
| `npm run seed:local` | Create the demo parcels, sales and dispute with real transactions |
| `npm run deploy:sepolia` | Deploy to Sepolia (see below) |

The compiler is the pinned `solc` 0.8.20 from `node_modules`, so nothing is downloaded at compile time.

## Demo accounts (local chain)

Ganache's deterministic accounts. Names live only in `shared/demo-accounts.local.json`, never on chain.

| # | Name | Role |
|---|---|---|
| 0 | Lands Commission | Registrar + admin (deployer) |
| 1 | Kwame Asante | Surveyor |
| 2 | Esi Quaye, Esq. | Lawyer |
| 3 | Abena Sarpong | Identity officer |
| 4 | Justice Ansah | Judge |
| 5 | Ama Owusu | Citizen, verified |
| 6 | Yaw Boakye | Citizen, verified |
| 7 | Kofi Mensah | Citizen, verified |
| 8 | Akosua Darko | Non-citizen, verified |
| 9 | Kwabena Ofori | Citizen, identity pending |
| 10 | Efua Mensah | Citizen, no profile yet |

The seed creates 14 parcels around Berekuso: titled, for sale, in escrow (GA-BRK-0012), sold, frozen by a judge
(GA-BRK-0011), disputed (GA-BRK-0006) and pending at different steps (GA-BRK-0013, GA-BRK-0014).

## Architecture

```
                  LandAccessControl  (one role hub: admin, registrar, surveyor, lawyer, ID officer, judge, agent)
                          ▲  every contract inherits LandRoleGuard and asks the hub "does X hold role Y?"
     ┌────────────────┬───┴──────────────┬─────────────────────┬─────────────────────┐
IdentityRegistry   TitleRegistry ◄──── Marketplace ◄────── DisputeResolution      TestCedi (tGHS)
 (who is who)      ERC-721 titles      list, escrow,        disputes, judge's       faucet, pays
                   apply → 3 sign-offs  registrar approves   ruling, freeze          for sales
                   → mint               (AGENT)              (AGENT)
```

Only the two **agent** contracts (Marketplace, DisputeResolution) may change a title's status or owner.

| Contract | Key functions |
|---|---|
| `LandAccessControl` | `grantRole`, `revokeRole`, `rolesOf`, `isOfficer` |
| `IdentityRegistry` | `submitProfile(cardHash, citizen)`, `verifyProfile`, `rejectProfile`, `profileOf`, `isVerified`, `members`, `publicIdOf` |
| `TitleRegistry` | `submitApplication(tuple)`, `approveSurvey`, `approveLegal`, `finalise`, `rejectApplication`, `getParcel`, `getBoundary`, `getDocs`, `getApplication`, `currentStep`, `recordOfParcelId`; agent-only `setStatus`, `agentTransfer` |
| `Marketplace` | `listForSale`, `cancelListing`, `buyListed`, `approveSale`, `rejectSale`, `listingOf`, `getSale`; agent-only `markDisputed`, `settleDispute` |
| `DisputeResolution` | `raiseDispute`, `resolveDispute`, `freezeTitle`, `unfreezeTitle`, `getDispute` |
| `TestCedi` | `faucet` (1,000,000 tGHS per hour), standard ERC-20, admin `mint` for seeding |

Every state change emits an event. The web app builds each parcel's history, the activity log and notifications from
these events; later the backend's event-sync job will index the same events into Postgres.

### How the front end uses them

| Screen action | Contract call(s) |
|---|---|
| Identity: submit Ghana Card | `IdentityRegistry.submitProfile(keccak256("landchain-card:" + card), citizen)` |
| Review queue: verify identity | `IdentityRegistry.verifyProfile(address)` |
| Register Land: submit | `TitleRegistry.submitApplication({parcelId, interest, holder, region, location, acresX100, lats, lngs, docs})` |
| Review queue: survey / legal / registrar | `approveSurvey(appId)`, `approveLegal(appId)`, `finalise(appId)` (mints the NFT) |
| List for sale | `Marketplace.listForSale(recordId, price)` |
| Buy | `TestCedi.approve(Marketplace, price)` then `Marketplace.buyListed(recordId)` |
| Registrar approves / rejects | `Marketplace.approveSale(saleId)` / `rejectSale(saleId)` |
| Raise dispute / judge rules | `DisputeResolution.raiseDispute(saleId, reason, evidenceHash)` / `resolveDispute(id, favourSeller)` |
| My Balance: faucet | `TestCedi.faucet()` |

### Design decisions worth defending in the review

- **Titles cannot be moved with `transferFrom`.** `TitleRegistry._update` refuses any transfer that has a caller
  (`auth != 0`). Mints and `agentTransfer` pass no caller, so every ownership change goes through a registrar-approved
  sale or a judge's ruling.
- **Pending ≠ minted.** An application creates a record (with an owner, boundary and documents) but no token. The
  ERC-721 is minted only when the registrar finalises, after surveyor and lawyer.
- **One active record per parcel id and per boundary** (keccak of the id / of the polygon). A rejection frees both so
  a corrected application can be made.
- **Coordinates are integers in micro-degrees** (5.603717 → 5603717), bounded to Ghana's box. Overlap between
  *different* polygons is checked in the web app before submitting, and will move to PostGIS on the backend; doing it
  on chain would cost gas per existing parcel.
- **Area** is computed off chain and stored in hundredths of an acre; the surveyor's sign-off attests it.
- **Privacy:** no names or Ghana Card numbers on chain, only the card's hash and a pseudonymous public ID
  (`GH-` + first 4 bytes of keccak256(address)).
- **Escrow is real money flow:** the buyer's tGHS sits in the Marketplace contract until the registrar or a judge
  releases it. `nonReentrant` guards every function that moves tokens.
- **Readable errors:** every `require` message is the sentence the UI shows, e.g. *"Only the surveyor can sign this
  step"*, *"Steps must happen in order: survey → legal → registrar"*.

## Deploy to Sepolia

Copy `.env.local.example` to `.env.local`, put a **throwaway** test wallet's key in `TESTNET_PRIVATE_KEY`, an RPC URL in
`SEPOLIA_RPC_URL`, and the officer addresses you want (they default to the deployer). Then `npm run deploy:sepolia`.
Addresses are recorded in `shared/deployments.json` (commit this file). In the web app set `VITE_CHAIN_ID=11155111`
and run `npm run contracts:sync`.

## Not in this milestone

Leases and ground rent, succession, fractional ownership, IPFS/Supabase storage for documents, the backend's event
indexer and backend-signed officer actions. Not audited: run Slither and a peer review before anything beyond a
testnet.
