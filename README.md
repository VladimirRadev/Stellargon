# Stellargon — Polymarket-style prediction market for the Stellar suite ($VLAD, Sepolia)

Stellargon is a clone of Polymarket (the prediction-market platform) implemented for Stellar, Vladimir Radev's
imaginary portfolio company, using its ERC-20 token $VLAD on Ethereum Sepolia. Stellar is unrelated to the Stellar
(XLM) network.

Stellargon has two contracts. `StellarPredict` holds the markets: people bet VLAD on the possible answers of a
real-world question. `StellarOracle` decides the answer: a group of human reporters, who lock VLAD as a stake, vote on
what actually happened. One difference from Polymarket is deliberate and should be stated up front: Polymarket
trades outcome shares on an order book and settles through the UMA optimistic oracle; Stellargon uses parimutuel
pools (explained below) and its own small voting oracle.

## How a market works

A market is one question with 2 to 8 options, for example "Yes" and "No". It has a `closeTime` (a Unix timestamp).

1. **Betting.** While `block.timestamp < closeTime`, anyone can call `bet(marketId, option, amount)`. The contract
   pulls `amount` VLAD from the bettor (an ERC-20 `transferFrom`, so the bettor first approves the contract) and adds
   it to the pool of that option. A bettor can bet on several options and can bet several times. A bet cannot be
   cancelled. At `closeTime` betting stops for good.
2. **Pools.** Every option has its own pool. `totalPool` is the sum of all option pools. This is a parimutuel market:
   there is no fixed price and no counterparty; the winners divide the money of the losers.
3. **Implied odds.** `impliedOdds(marketId)` returns, for each option, its pool divided by the total pool, in basis
   points (10,000 = 100%). If 25 VLAD are on "Yes" and 75 VLAD on "No", the odds are 2,500 and 7,500, which reads as
   "the bettors as a group give Yes a 25% chance". While the pool is empty, the odds are split evenly.
4. **Resolving.** The market asks the oracle its question in the same transaction that creates it. The oracle voting
   runs from `closeTime` to `closeTime + resolveWindow`. Once the oracle has finalized an answer, anyone can call
   `resolve(marketId)`.
5. **The fee.** At `resolve`, 2% of the total pool (`feeBps = 200`) is sent with a plain VLAD transfer to the Stellar
   Arena prize pool (`0xE79302DAebc28297745afC206553afBeD9d04d60`). The Arena counts its prize pool as its own VLAD
   balance, so the transfer directly increases the prizes paid to Arena players.
6. **Claiming.** Each winner calls `claim(marketId)` once and receives
   `yourStakeOnWinner × (totalPool − fee) / winningPool`.

Worked example: alice bets 30 VLAD and bob 10 VLAD on "Yes"; carol bets 60 VLAD on "No". The total pool is 100 VLAD.
The oracle answers "Yes". The fee is 2 VLAD, so 98 VLAD remain for the "Yes" side, whose pool is 40 VLAD. Alice
receives 30 × 98 / 40 = 73.5 VLAD and bob receives 10 × 98 / 40 = 24.5 VLAD. Carol receives nothing.

**Voided markets.** A market is voided instead of resolved in two cases: the oracle answer is `INVALID` (255), or
nobody bet on the winning option (so nobody could be paid). In a voided market no fee is taken and every bettor
claims back exactly the VLAD they bet, on all options.

Rounding: integer division can leave a few wei (10⁻¹⁸ VLAD) per resolved market in the contract after all winners
have claimed. They stay there; nobody can withdraw them.

## How the oracle works

`StellarOracle` is a human voting oracle. Its job is to store, for each question, which option the reporters
voted for.

1. **Reporters.** A reporter is an account with `REPORTER_ROLE`. Anyone can become one by calling `joinAsReporter()`,
   which locks 100 VLAD (`reporterStake`) in the oracle. The admin can also add a reporter without a stake
   (`addReporter`) and remove one (`removeReporter`). The oracle allows at most 100 reporters at a time, so that
   `finalize` always fits in one transaction.
2. **Questions.** `StellarPredict` holds `ASKER_ROLE` and asks for free. A reporter can also ask a stand-alone
   question; that costs 10 VLAD (`questionFee`), sent to the Arena prize pool, to make spam expensive.
3. **Voting.** Each reporter casts at most one vote per question, between `votingStart` and `votingEnd` (both
   inclusive). For a market, `votingStart` is the market's `closeTime`.
4. **Finalizing.** After `votingEnd`, anyone calls `finalize(qid)`. The option with the most votes wins (plurality).
   If two or more options share the highest count, or nobody voted, the answer is `INVALID` = 255.
5. **Slashing.** If there is a winner, every reporter who voted for a different option loses 10% (`slashBps = 1000`)
   of their current stake. The slashed VLAD is split equally among the reporters who voted for the winner and is
   added to their stakes. The few wei that do not divide evenly go to the Arena prize pool. Example: 3 reporters vote
   "Yes", 2 vote "No", every stake is 100 VLAD. Each "No" voter loses 10 VLAD, so 20 VLAD are split three ways: each
   "Yes" voter gains 6.666666666666666666 VLAD and 2 wei go to the Arena. When the answer is `INVALID`, nobody is
   slashed.
6. **Leaving.** `leave()` returns the whole remaining stake. It reverts with `HasOpenVotes` while the reporter has a
   vote on a question that is not finalized yet, so a reporter cannot withdraw before a possible slash.

## How to join

- **Become a reporter:** approve 100 VLAD to `StellarOracle`, then call `joinAsReporter()`. Vote only after the
  data source named in the question has published the answer.
- **Become a market creator:** approve 50 VLAD to `StellarPredict`, then call `applyAsCreator()`. The 50 VLAD
  (`CREATOR_FEE`) go to the Arena prize pool and you receive `CREATOR_ROLE`. The admin can also grant the role.
  A creator calls `createMarket(question, options, closeTime, resolveWindow)`. Write the question so that anyone
  can check the answer from a public source, and name that source in the question text.

VLAD comes from the faucet at https://vladimirradev.github.io/Stellar-Faucet/.

## Trust model (stated honestly)

- This is a demo oracle voted by humans. It is not UMA, not Chainlink, and nothing on chain checks the real world.
- A majority of the reporters who vote can finalize a wrong answer, and the minority who told the truth would then
  be slashed. Slashing rewards agreeing with the majority; it does not prove the majority is right.
- The admin can add reporters without a stake. Such a reporter has nothing to lose to slashing, and an admin who adds
  many reporters can control every outcome. On this testnet deployment the admin is the deployer.
- The admin cannot move anyone's bets or stakes: neither contract has an admin withdrawal function.
- Use testnet VLAD only. It has no monetary value.

## Contracts

| Contract | What it does |
|---|---|
| `src/StellarOracle.sol` | Reporters, stakes, questions, votes, plurality finalization, slashing |
| `src/StellarPredict.sol` | Markets, parimutuel pools, implied odds, resolution, 2% fee, claims and refunds |
| `src/interfaces/` | `IStellarOracle`, `IStellarPredict` (for the web app), `IVladToken` (copied from Stellar-Arena) |

Both contracts use OpenZeppelin `AccessControl`, `ReentrancyGuard` (on every function that moves VLAD) and
`SafeERC20`, and report failures with custom errors. Runtime sizes: StellarOracle 8,719 bytes, StellarPredict
8,050 bytes (limit 24,576).

### Addresses (Sepolia)

| Contract | Address |
|---|---|
| StellarOracle | TODO (not deployed yet) |
| StellarPredict | TODO (not deployed yet) |
| $VLAD token (Stellar-Faucet) | [`0x49ba857d553ef219B144b200F41acaf8CB6768E9`](https://eth-sepolia.blockscout.com/address/0x49ba857d553ef219B144b200F41acaf8CB6768E9) |
| Fee sink: StellarArena prize pool (Stellar-Arena) | [`0xE79302DAebc28297745afC206553afBeD9d04d60`](https://eth-sepolia.blockscout.com/address/0xE79302DAebc28297745afC206553afBeD9d04d60) |

Parameters: reporter stake 100 VLAD, question fee 10 VLAD, slash 10%, creator application 50 VLAD, market fee 2%.

## Development

```bash
forge build --sizes
forge test -vv
forge fmt --check
```

Deploy. The private key is read from an env file outside the repo and is never printed or committed:

```bash
set -a; source ~/Downloads/Stellar-deployer.env; set +a
VLAD_TOKEN=0x49ba857d553ef219B144b200F41acaf8CB6768E9 FEE_SINK=0xE79302DAebc28297745afC206553afBeD9d04d60 \
  forge script script/Deploy.s.sol --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --broadcast --slow --skip-simulation --priority-gas-price 10000000 --with-gas-price 1000000000 -vvv
```

- `--skip-simulation`: Sepolia charges contract creation more gas than forge's local simulation, so a gas limit
  taken from the simulation can run out of gas. Skipping it lets the Sepolia node estimate the gas.
- `--slow`: sends one transaction at a time and waits for each receipt. The deployer is an EIP-7702 delegated
  account, and nodes accept only one in-flight transaction from it. If a transaction is rejected with "in-flight
  transaction limit reached for delegated accounts", wait about 20 seconds and rerun the command with `--resume`.
- Optional `ETH_STRIKE_USD` (default 2500) sets the price in the first seed market.

The script sends seven transactions, in this order:

1. create `StellarOracle(vlad, 100 VLAD stake, 10 VLAD question fee, 1000 bps slash, Arena)`;
2. create `StellarPredict(vlad, oracle, Arena, 200 bps fee)`;
3. `oracle.grantRole(ASKER_ROLE, predict)`, so markets can ask the oracle for free;
4. `predict.grantRole(CREATOR_ROLE, deployer)`;
5. – 7. `predict.createMarket` three times. Each seed market has the options "Yes" and "No", closes 7 days after the
   deployment block and has a 3-day voting window. The dates and the block number are computed from the deployment
   block:
   - "Will ETH/USD close above $2,500 on *close date* (UTC)? Source: CoinGecko Ethereum historical data, the Close
     column for *close date*."
   - "Will Bitcoin's 7-day average hashrate on *close date* be higher than on *deploy date*? Source:
     blockchain.com/explorer/charts/hash-rate with the 7-day average."
   - "Will the Sepolia base fee of block *N* be above 1 gwei? Source: baseFeePerGas of block *N* on
     eth-sepolia.blockscout.com." *N* is the deployment block + 50,700 (7 days of 12-second slots plus about one
     hour), so block *N* is mined after betting closes.

## Web app

Live: **https://vladimirradev.github.io/Stellargon/** (GitHub Pages, deployed by `.github/workflows/pages.yml` on
every push to `main`).

The app in `web/` is a static React page (Vite, React 19, TypeScript, Tailwind CSS 4, wagmi 3, viem 2). It reads
Sepolia through public RPC endpoints only and connects to MetaMask; there is no backend. The shared Stellar frame
(navigation across the six apps, wallet button, VLAD balance, footer, transaction button) lives in `web/src/shell/`
and is identical in every Stellar repo.

- **Markets tab.** A grid of market cards, newest first, with filters (Open, Closed, Resolved, Voided) and a search
  box. Each card shows the question, every option's implied chance as a percentage with a bar (`impliedOdds`), the
  total pool and a countdown to the close. Clicking a card opens the market panel: pick an option, enter a VLAD
  amount (balance and MAX shown), approve VLAD once if the allowance is too low, then bet. The panel previews the
  payout if your option wins (`amount × (total pool + amount) × 98% / (option pool + amount)`, with the pools as they
  are now), lists your positions (`positionOf`), offers "Finalize the oracle vote" and "Resolve market" once
  possible, and "Claim" when you have something to claim (`claimableOf`). A voided market shows a refund note.
- **Oracle tab.** Your reporter status and stake, "Become a reporter" (approve 100 VLAD, then join) and "Leave"
  (disabled, with the reason, while you have votes on questions that are not finalized), the reporter list, the
  questions grouped as voting now / ready to finalize / upcoming / finalized with vote buttons, countdowns and
  tallies, and the slashing rule.
- **Create tab.** Your creator status, "Apply as creator" (approve 50 VLAD, then apply), and the market form:
  question (name a public data source), 2 to 8 options, close date and time, and the reporter voting window
  (3 days by default). Below it, the markets you created.

Every read passes `chainId: 11155111`, so the page reads Sepolia even while the wallet is on another network.
Custom errors of both contracts are decoded into readable sentences before the wallet opens.

```bash
cd web
npm install
npm run sync-abi   # after `forge build` in the repo root; copies the ABIs into src/abi
npm run dev        # http://localhost:5173/Stellargon/
npm run build
```

After deployment, put the oracle and predict addresses into `web/src/config/addresses.ts`. While they are zero,
the page shows a "not deployed yet" banner, switches all on-chain reads off and previews the three seed markets.

## Part of the Stellar suite

| Repo | Site |
|---|---|
| [Stellar-Faucet](https://github.com/VladimirRadev/Stellar-Faucet) | https://vladimirradev.github.io/Stellar-Faucet/ |
| [Stellar-LP-Staking](https://github.com/VladimirRadev/Stellar-LP-Staking) | https://vladimirradev.github.io/Stellar-LP-Staking/ |
| [Stellar-Bank](https://github.com/VladimirRadev/Stellar-Bank) | https://vladimirradev.github.io/Stellar-Bank/ |
| [Stellar-Store](https://github.com/VladimirRadev/Stellar-Store) | https://vladimirradev.github.io/Stellar-Store/ |
| [Stellar-Arena](https://github.com/VladimirRadev/Stellar-Arena) | https://vladimirradev.github.io/Stellar-Arena/ |
| [Stellargon](https://github.com/VladimirRadev/Stellargon) | https://vladimirradev.github.io/Stellargon/ |
