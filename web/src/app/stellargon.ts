// Contract handles, market math (mirrors src/StellarPredict.sol and src/StellarOracle.sol), readable errors and
// the shared read hooks of the Stellargon page.
import { formatUnits, keccak256, parseUnits, stringToHex, type Abi, type Address } from 'viem'
import { useConnection, useReadContract, useReadContracts } from 'wagmi'
import { iVladTokenAbi, stellarOracleAbi, stellarPredictAbi } from '../abi'
import { CHAIN_ID, addresses } from '../config/addresses'
import type { ErrorMessages } from '../shell/errors'
import { formatDuration, isConfiguredAddress } from '../shell/format'

export const DEPLOYED =
  isConfiguredAddress(addresses.predict) && isConfiguredAddress(addresses.oracle) && isConfiguredAddress(addresses.vladToken)

export const predict = { address: addresses.predict, abi: stellarPredictAbi, chainId: CHAIN_ID } as const
export const oracle = { address: addresses.oracle, abi: stellarOracleAbi, chainId: CHAIN_ID } as const
export const token = { address: addresses.vladToken, abi: iVladTokenAbi, chainId: CHAIN_ID } as const

/** `createMarket` calls the oracle, so its reverts can carry oracle errors: merge them in for decoding. */
const predictErrorNames = new Set<string>(stellarPredictAbi.filter((e) => e.type === 'error').map((e) => e.name))
export const PREDICT_PLUS_ORACLE_ERRORS_ABI = [
  ...stellarPredictAbi,
  ...stellarOracleAbi.filter((e) => e.type === 'error' && !predictErrorNames.has(e.name)),
] as Abi

// Roles are keccak256 of their names, exactly as in the contracts.
export const CREATOR_ROLE = keccak256(stringToHex('CREATOR_ROLE'))
export const REPORTER_ROLE = keccak256(stringToHex('REPORTER_ROLE'))

// Deployment parameters (see script/Deploy.s.sol). The contracts store them as immutables.
export const WAD = 10n ** 18n
export const BPS = 10_000n
export const FEE_BPS = 200n
export const REPORTER_STAKE = 100n * WAD
export const QUESTION_FEE = 10n * WAD
export const CREATOR_FEE = 50n * WAD
export const SLASH_BPS = 1_000n
export const INVALID = 255
export const MAX_OPTIONS = 8
/** How many of the newest markets / questions the page loads. */
export const MAX_ITEMS = 60

export const State = { OPEN: 0, CLOSED: 1, RESOLVED: 2, VOIDED: 3 } as const
export type StateKey = 'open' | 'closed' | 'resolved' | 'voided'

export const ERRORS: ErrorMessages = {
  // StellarPredict
  NotCreator: () => 'Only market creators can open markets. Apply as a creator first.',
  AlreadyCreator: () => 'You already hold the creator role.',
  UnknownMarket: () => 'This market does not exist.',
  BadTimes: () => 'The close time must be in the future and the voting window longer than zero.',
  BadOption: () => 'That option does not exist.',
  ZeroAmount: () => 'Enter an amount greater than zero.',
  MarketClosed: () => 'Betting on this market has closed.',
  MarketOpen: () => 'The market is still open for bets; it can be resolved after it closes.',
  OracleNotFinal: () => 'The oracle has not finalized this question yet.',
  AlreadyResolved: () => 'This market is already settled.',
  NotResolved: () => 'The market is not settled yet, so there is nothing to claim.',
  AlreadyClaimed: () => 'You already claimed from this market.',
  NothingToClaim: () => 'You have nothing to claim from this market.',
  // StellarOracle
  NotReporter: () => 'Only reporters can do this. Become a reporter first.',
  AlreadyReporter: () => 'You are already a reporter.',
  TooManyReporters: () => 'The oracle is full (100 reporters, or 100 votes on this question).',
  HasOpenVotes: () => 'You still have votes on questions that are not finalized. Leave after they are finalized.',
  BadOptions: () => 'A question needs between 2 and 8 options.',
  BadWindow: () => 'The voting window must end in the future and after it starts.',
  UnknownQuestion: () => 'This oracle question does not exist.',
  VotingNotOpen: () => 'Voting on this question has not started yet.',
  VotingClosed: () => 'Voting on this question has ended.',
  AlreadyVoted: () => 'You already voted on this question.',
  NotFinalizable: () => 'Voting is still running; finalize after the voting window ends.',
  AlreadyFinalized: () => 'This question is already finalized.',
}

export type Market = {
  id: number
  question: string
  options: readonly string[]
  closeTime: number
  votingEnd: number
  oracleQid: bigint
  pools: readonly bigint[]
  totalPool: bigint
  fee: bigint
  /** The state the contract reports (CLOSED is derived on chain from OPEN + closeTime). */
  state: number
  winner: number
  creator: Address
  /** impliedOdds(id), basis points per option. */
  odds: readonly bigint[]
}

type MarketView = {
  question: string
  options: readonly string[]
  closeTime: bigint
  votingEnd: bigint
  oracleQid: bigint
  pools: readonly bigint[]
  totalPool: bigint
  fee: bigint
  state: number
  winner: number
  creator: Address
}

export type Question = {
  qid: number
  text: string
  options: readonly string[]
  votes: readonly number[]
  asker: Address
  votingStart: number
  votingEnd: number
  finalized: boolean
  winner: number
  voterCount: number
}

type QuestionView = Omit<Question, 'qid' | 'votingStart' | 'votingEnd' | 'voterCount'> & {
  votingStart: bigint
  votingEnd: bigint
  voterCount: bigint
}

/** State shown in the UI: a stored OPEN market whose close time passed in the browser clock reads as CLOSED. */
export function stateOf(m: Pick<Market, 'state' | 'closeTime'>, now: number): StateKey {
  if (m.state === State.RESOLVED) return 'resolved'
  if (m.state === State.VOIDED) return 'voided'
  return m.state === State.CLOSED || now >= m.closeTime ? 'closed' : 'open'
}

/** Newest-first ids n-1 … max(0, n-MAX_ITEMS). */
const newestIds = (n: number) => Array.from({ length: Math.min(n, MAX_ITEMS) }, (_, k) => n - 1 - k)

/** All markets (newest first), each with its implied odds. */
export function useMarkets() {
  const count = useReadContract({ ...predict, functionName: 'marketCount', query: { enabled: DEPLOYED, refetchInterval: 15_000 } })
  const ids = newestIds(Number(count.data ?? 0n))
  const q = useReadContracts({
    contracts: ids.flatMap((i) => [
      { ...predict, functionName: 'market', args: [BigInt(i)] } as const,
      { ...predict, functionName: 'impliedOdds', args: [BigInt(i)] } as const,
    ]),
    query: { enabled: DEPLOYED && ids.length > 0, refetchInterval: 15_000 },
  })
  const markets: Market[] = []
  ids.forEach((id, k) => {
    const v = q.data?.[2 * k]?.result as MarketView | undefined
    const odds = q.data?.[2 * k + 1]?.result as readonly bigint[] | undefined
    if (!v) return
    markets.push({
      id,
      question: v.question,
      options: v.options,
      closeTime: Number(v.closeTime),
      votingEnd: Number(v.votingEnd),
      oracleQid: v.oracleQid,
      pools: v.pools,
      totalPool: v.totalPool,
      fee: v.fee,
      state: v.state,
      winner: v.winner,
      creator: v.creator,
      odds: odds ?? v.pools.map(() => 0n),
    })
  })
  return {
    count: count.data,
    markets,
    loading: DEPLOYED && (count.isLoading || (ids.length > 0 && q.isLoading)),
  }
}

/** Oracle questions (newest first). */
export function useQuestions() {
  const count = useReadContract({ ...oracle, functionName: 'questionCount', query: { enabled: DEPLOYED, refetchInterval: 15_000 } })
  const ids = newestIds(Number(count.data ?? 0n))
  const q = useReadContracts({
    contracts: ids.map((i) => ({ ...oracle, functionName: 'question', args: [BigInt(i)] }) as const),
    query: { enabled: DEPLOYED && ids.length > 0, refetchInterval: 15_000 },
  })
  const questions: Question[] = []
  ids.forEach((qid, k) => {
    const v = q.data?.[k]?.result as QuestionView | undefined
    if (!v) return
    questions.push({
      ...v,
      qid,
      votingStart: Number(v.votingStart),
      votingEnd: Number(v.votingEnd),
      voterCount: Number(v.voterCount),
    })
  })
  return { count: count.data, questions, loading: DEPLOYED && (count.isLoading || (ids.length > 0 && q.isLoading)) }
}

/** Reporter list with each reporter's stake. */
export function useReporters() {
  const list = useReadContract({ ...oracle, functionName: 'reporters', query: { enabled: DEPLOYED, refetchInterval: 15_000 } })
  const reporters = (list.data ?? []) as readonly Address[]
  const stakes = useReadContracts({
    contracts: reporters.map((r) => ({ ...oracle, functionName: 'stakeOf', args: [r] }) as const),
    query: { enabled: DEPLOYED && reporters.length > 0, refetchInterval: 15_000 },
  })
  return {
    reporters: reporters.map((address, i) => ({ address, stake: stakes.data?.[i]?.result as bigint | undefined })),
    loading: DEPLOYED && list.isLoading,
  }
}

/** The connected wallet as a reporter: role, stake, open votes and VLAD allowance for the oracle. */
export function useMyReporter() {
  const { address } = useConnection()
  const q = useReadContracts({
    contracts: address
      ? [
          { ...oracle, functionName: 'hasRole', args: [REPORTER_ROLE, address] },
          { ...oracle, functionName: 'stakeOf', args: [address] },
          { ...oracle, functionName: 'openVotes', args: [address] },
          { ...token, functionName: 'allowance', args: [address, addresses.oracle] },
        ]
      : [],
    query: { enabled: DEPLOYED && !!address, refetchInterval: 15_000 },
  })
  return {
    address,
    isReporter: q.data?.[0]?.result as boolean | undefined,
    stake: q.data?.[1]?.result as bigint | undefined,
    openVotes: q.data?.[2]?.result as bigint | undefined,
    allowance: q.data?.[3]?.result as bigint | undefined,
    loading: DEPLOYED && !!address && q.isLoading,
  }
}

/** The connected wallet as a market creator: role and VLAD allowance for StellarPredict. */
export function useMyCreator() {
  const { address } = useConnection()
  const q = useReadContracts({
    contracts: address
      ? [
          { ...predict, functionName: 'hasRole', args: [CREATOR_ROLE, address] },
          { ...token, functionName: 'allowance', args: [address, addresses.predict] },
        ]
      : [],
    query: { enabled: DEPLOYED && !!address, refetchInterval: 15_000 },
  })
  return {
    address,
    isCreator: q.data?.[0]?.result as boolean | undefined,
    allowance: q.data?.[1]?.result as bigint | undefined,
    loading: DEPLOYED && !!address && q.isLoading,
  }
}

/** Per-market data for the connected wallet plus the oracle's view of the market's question. */
export function useMarketDetail(m: Market | undefined) {
  const { address } = useConnection()
  const id = BigInt(m?.id ?? 0)
  const qid = m?.oracleQid ?? 0n
  const enabled = DEPLOYED && !!m
  const o = useReadContracts({
    contracts: [
      { ...oracle, functionName: 'result', args: [qid] },
      { ...oracle, functionName: 'question', args: [qid] },
    ],
    query: { enabled, refetchInterval: 15_000 },
  })
  const u = useReadContracts({
    contracts: address
      ? [
          { ...predict, functionName: 'positionOf', args: [id, address] },
          { ...predict, functionName: 'claimableOf', args: [id, address] },
          { ...predict, functionName: 'claimed', args: [id, address] },
          { ...token, functionName: 'allowance', args: [address, addresses.predict] },
        ]
      : [],
    query: { enabled: enabled && !!address, refetchInterval: 15_000 },
  })
  const result = o.data?.[0]?.result as readonly [boolean, number] | undefined
  const question = o.data?.[1]?.result as QuestionView | undefined
  return {
    oracleFinal: result?.[0],
    oracleWinner: result?.[1],
    oracleVotes: question?.votes,
    voterCount: question ? Number(question.voterCount) : undefined,
    position: u.data?.[0]?.result as readonly bigint[] | undefined,
    claimable: u.data?.[1]?.result as bigint | undefined,
    claimed: u.data?.[2]?.result as boolean | undefined,
    allowance: u.data?.[3]?.result as bigint | undefined,
  }
}

/** hasVoted(qid, me) for a list of questions. */
export function useMyVotes(qids: readonly number[]) {
  const { address } = useConnection()
  const q = useReadContracts({
    contracts: address ? qids.map((qid) => ({ ...oracle, functionName: 'hasVoted', args: [BigInt(qid), address] }) as const) : [],
    query: { enabled: DEPLOYED && !!address && qids.length > 0, refetchInterval: 15_000 },
  })
  const voted = new Map<number, boolean>()
  qids.forEach((qid, i) => voted.set(qid, q.data?.[i]?.result === true))
  return voted
}

// ------------------------------------------------------------------ math

/**
 * Payout if `option` wins, for a new bet of `amount` on it, assuming no further bets:
 * amount × (totalPool + amount) × (1 − fee) / (optionPool + amount).
 */
export function payoutPreview(m: Market, option: number, amount: bigint): bigint {
  if (amount <= 0n) return 0n
  const total = m.totalPool + amount
  const pool = (m.pools[option] ?? 0n) + amount
  const fee = (total * FEE_BPS) / BPS
  return (amount * (total - fee)) / pool
}

/** Percentage string from basis points: 6234n -> "62%", 50n -> "<1%". */
export function pct(bps: bigint | undefined): string {
  if (bps === undefined) return '—'
  if (bps > 0n && bps < 100n) return '<1%'
  return `${Math.round(Number(bps) / 100)}%`
}

/** Even odds for an empty pool, otherwise the contract's impliedOdds. */
export function oddsOf(m: Pick<Market, 'odds' | 'options'>): readonly bigint[] {
  return m.odds.length === m.options.length ? m.odds : m.options.map(() => BPS / BigInt(m.options.length))
}

/** Parses a user-typed decimal amount; undefined when empty, invalid or zero. */
export function parseAmount(input: string): bigint | undefined {
  if (!input.trim()) return undefined
  try {
    const v = parseUnits(input.trim(), 18)
    return v > 0n ? v : undefined
  } catch {
    return undefined
  }
}

/** Bigint wei -> plain decimal string for an input field (no separators), rounded down to `maxDigits`. */
export function toInput(value: bigint, maxDigits = 6): string {
  const [whole, fraction = ''] = formatUnits(value, 18).split('.')
  const f = fraction.slice(0, maxDigits).replace(/0+$/, '')
  return f ? `${whole}.${f}` : whole
}

/** "in 3d 4h" / "2h 10m ago". */
export function relative(target: number, now: number): string {
  const d = target - now
  return d >= 0 ? `in ${formatDuration(d)}` : `${formatDuration(-d)} ago`
}
