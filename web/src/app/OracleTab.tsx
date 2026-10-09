import { stellarOracleAbi } from '../abi'
import { addresses } from '../config/addresses'
import { explorerAddressUrl, formatCountdown, formatTimestamp, formatToken, truncateAddress } from '../shell/format'
import { NetworkGate } from '../shell/NetworkGate'
import { TxButton } from '../shell/TxButton'
import { useNow } from '../shell/useNow'
import { useVladBalance } from '../shell/useVladBalance'
import {
  DEPLOYED,
  ERRORS,
  INVALID,
  REPORTER_STAKE,
  SLASH_BPS,
  useMyReporter,
  useMyVotes,
  useQuestions,
  useReporters,
  type Question,
} from './stellargon'
import { ApproveThen, Empty, Line, Note } from './ui'

type Phase = 'voting' | 'ready' | 'upcoming' | 'final'
const phaseOf = (q: Question, now: number): Phase =>
  q.finalized ? 'final' : now < q.votingStart ? 'upcoming' : now <= q.votingEnd ? 'voting' : 'ready'

const PHASES: readonly { key: Phase; title: string; empty: string }[] = [
  { key: 'voting', title: 'Voting now', empty: 'No question is in its voting window right now.' },
  { key: 'ready', title: 'Ready to finalize', empty: 'Nothing is waiting to be finalized.' },
  { key: 'upcoming', title: 'Upcoming', empty: 'No question is waiting for its window to open.' },
  { key: 'final', title: 'Finalized', empty: 'No question has been finalized yet.' },
]

export function OracleTab() {
  return (
    <div className="space-y-8">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card min-w-0 p-5 sm:p-6">
          <p className="eyebrow">Your reporter seat</p>
          <div className="mt-4">
            <NetworkGate connectMessage="Connect MetaMask to become a reporter and vote.">
              <MySeat />
            </NetworkGate>
          </div>
        </div>
        <ReportersCard />
        <SlashingCard />
      </div>
      <Questions />
    </div>
  )
}

function MySeat() {
  const me = useMyReporter()
  const { balance } = useVladBalance()
  const open = me.openVotes ?? 0n
  const stake = me.stake ?? 0n

  if (!DEPLOYED) return <p className="text-sm text-muted">The oracle is not deployed yet.</p>
  if (me.loading) return <span className="skeleton h-24 w-full" />

  if (me.isReporter || stake > 0n) {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          {me.isReporter ? (
            <span className="font-semibold text-accent-2">You are a reporter.</span>
          ) : (
            <span className="text-warning">You were removed as a reporter; your stake is still here.</span>
          )}
        </p>
        <div className="divide-y divide-border/70 border-y border-border/70">
          <Line label="Your stake" tone="good">
            {formatToken(stake)} VLAD
          </Line>
          <Line label="Votes on open questions">{open.toString()}</Line>
        </div>
        <TxButton
          request={{ address: addresses.oracle, abi: stellarOracleAbi, functionName: 'leave' }}
          disabled={open > 0n}
          errorMessages={ERRORS}
          className="w-full"
        >
          {me.isReporter ? 'Leave and withdraw' : 'Withdraw stake'} {formatToken(stake)} VLAD
        </TxButton>
        {open > 0n ? (
          <p className="text-xs text-muted">
            Leaving is blocked while you have {open.toString()} vote{open === 1n ? '' : 's'} on questions that are not
            finalized, so nobody can withdraw before a possible slash.
          </p>
        ) : null}
      </div>
    )
  }

  const short = balance !== undefined && balance < REPORTER_STAKE
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted">
        Lock <span className="font-mono text-text">{formatToken(REPORTER_STAKE)} VLAD</span> to join the oracle. You can
        then vote once on every question, and leave with your stake when none of your votes is pending.
      </p>
      {short ? <p className="text-sm text-danger">You need {formatToken(REPORTER_STAKE)} VLAD; your balance is {formatToken(balance)}.</p> : null}
      <ApproveThen spender={addresses.oracle} need={REPORTER_STAKE} allowance={me.allowance} disabled={short}>
        <TxButton
          request={{ address: addresses.oracle, abi: stellarOracleAbi, functionName: 'joinAsReporter' }}
          disabled={short}
          errorMessages={ERRORS}
          className="h-12 w-full"
        >
          Become a reporter · stake {formatToken(REPORTER_STAKE)} VLAD
        </TxButton>
      </ApproveThen>
    </div>
  )
}

function ReportersCard() {
  const { reporters, loading } = useReporters()
  const me = useMyReporter()
  return (
    <div className="card min-w-0 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <p className="eyebrow">Reporters</p>
        <span className="font-mono text-2xl font-semibold text-accent-2">{DEPLOYED ? reporters.length : '—'}</span>
      </div>
      {!DEPLOYED ? (
        <p className="mt-4 text-sm text-muted">The reporter list appears once the oracle is deployed.</p>
      ) : loading ? (
        <span className="skeleton mt-4 h-24 w-full" />
      ) : reporters.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No reporters yet. Be the first.</p>
      ) : (
        <ul className="mt-4 max-h-56 divide-y divide-border/70 overflow-y-auto pr-1">
          {reporters.map((r) => (
            <li key={r.address} className="flex items-center justify-between gap-3 py-2 text-sm">
              <a className="link truncate font-mono" href={explorerAddressUrl(r.address)} target="_blank" rel="noreferrer">
                {truncateAddress(r.address)}
                {me.address && r.address.toLowerCase() === me.address.toLowerCase() ? (
                  <span className="ml-1.5 text-xs text-lime">you</span>
                ) : null}
              </a>
              <span className="shrink-0 font-mono text-muted">{formatToken(r.stake, 18, 1)} VLAD</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted">At most 100 reporters at a time, so finalizing always fits in one transaction.</p>
    </div>
  )
}

function SlashingCard() {
  const slash = Number(SLASH_BPS) / 100
  return (
    <div className="card min-w-0 p-5 sm:p-6">
      <p className="eyebrow">How a vote settles</p>
      <ol className="mt-4 space-y-3 text-sm leading-relaxed text-muted">
        <li>
          <span className="font-semibold text-text">Plurality.</span> After the window ends anyone finalizes; the option
          with the most votes wins.
        </li>
        <li>
          <span className="font-semibold text-text">Tie or no votes</span> → INVALID: no slashing, and the market refunds
          every bet.
        </li>
        <li>
          <span className="font-semibold text-text">Slashing.</span> Each reporter who voted for another option loses{' '}
          {slash}% of their stake. The slashed VLAD is split equally among the reporters who voted for the winner.
        </li>
      </ol>
      <p className="mt-4 rounded-xl border border-border/80 bg-bg/40 px-3.5 py-2.5 font-mono text-xs leading-relaxed text-muted">
        3 vote Yes, 2 vote No, 100 VLAD stakes → each No voter loses 10 VLAD; each Yes voter gains 20 / 3 = 6.67 VLAD.
      </p>
    </div>
  )
}

function Questions() {
  const { questions, loading } = useQuestions()
  const now = useNow()
  const me = useMyReporter()
  const voted = useMyVotes(questions.map((q) => q.qid))

  if (!DEPLOYED) {
    return <Empty title="Oracle not deployed yet">Questions open for voting will be listed here.</Empty>
  }
  if (loading) return <span className="skeleton h-40 w-full" />
  if (questions.length === 0) {
    return <Empty title="No questions yet">Every new market asks the oracle a question; it appears here.</Empty>
  }

  return (
    <div className="space-y-8">
      {PHASES.map((phase) => {
        const list = questions.filter((q) => phaseOf(q, now) === phase.key)
        if (phase.key !== 'voting' && list.length === 0) return null
        return (
          <section key={phase.key} aria-label={phase.title}>
            <div className="flex items-baseline gap-2">
              <h3 className="text-lg font-semibold">{phase.title}</h3>
              <span className="font-mono text-sm text-muted">{list.length}</span>
            </div>
            {list.length === 0 ? (
              <p className="mt-2 text-sm text-muted">{phase.empty}</p>
            ) : (
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                {list.map((q) => (
                  <QuestionCard
                    key={q.qid}
                    q={q}
                    phase={phase.key}
                    now={now}
                    canVote={!!me.isReporter && phase.key === 'voting' && !voted.get(q.qid)}
                    hasVoted={!!voted.get(q.qid)}
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function QuestionCard({
  q,
  phase,
  now,
  canVote,
  hasVoted,
}: {
  q: Question
  phase: Phase
  now: number
  canVote: boolean
  hasVoted: boolean
}) {
  const total = q.votes.reduce((a, b) => a + b, 0)
  const fromMarket = q.asker.toLowerCase() === addresses.predict.toLowerCase()
  return (
    <article className="card flex min-w-0 flex-col p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="font-mono">
          Question #{q.qid} · {fromMarket ? 'from a market' : `asked by ${truncateAddress(q.asker)}`}
        </span>
        <span className="font-mono">
          {phase === 'voting'
            ? `ends in ${formatCountdown(q.votingEnd - now)}`
            : phase === 'upcoming'
              ? `opens in ${formatCountdown(q.votingStart - now)}`
              : phase === 'ready'
                ? `ended ${formatTimestamp(q.votingEnd)}`
                : `${total} vote${total === 1 ? '' : 's'}`}
        </span>
      </div>
      <h4 className="mt-2 break-words font-display text-base font-semibold leading-snug">{q.text}</h4>

      <ul className="mt-4 space-y-2.5">
        {q.options.map((label, i) => {
          const v = q.votes[i] ?? 0
          const share = total ? (v / total) * 100 : 0
          const won = q.finalized && q.winner === i
          return (
            <li key={i}>
              <div className="flex items-center justify-between gap-3">
                <span className={`min-w-0 truncate text-sm ${won ? 'font-semibold text-lime' : ''}`}>
                  {won ? '✓ ' : ''}
                  {label}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-sm text-muted">
                    {v} vote{v === 1 ? '' : 's'}
                  </span>
                  {canVote ? (
                    <TxButton
                      request={{ address: addresses.oracle, abi: stellarOracleAbi, functionName: 'vote', args: [BigInt(q.qid), i] }}
                      errorMessages={ERRORS}
                      className="h-8 min-h-0 px-3 text-xs"
                    >
                      Vote
                    </TxButton>
                  ) : null}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div className={`h-full rounded-full ${won ? 'bg-lime' : 'bg-accent'}`} style={{ width: `${share}%` }} />
              </div>
            </li>
          )
        })}
      </ul>

      <div className="mt-4 space-y-2 border-t border-border/70 pt-3 text-xs text-muted">
        <p>
          Window: {formatTimestamp(q.votingStart)} → {formatTimestamp(q.votingEnd)}
        </p>
        {q.finalized && q.winner === INVALID ? <Note tone="warn">INVALID: a tie or no votes. Nobody was slashed.</Note> : null}
        {hasVoted && !q.finalized ? <p className="text-accent-2">You voted on this question.</p> : null}
        {phase === 'voting' && !canVote && !hasVoted ? <p>Only reporters can vote.</p> : null}
      </div>

      {phase === 'ready' ? (
        <div className="mt-3">
          <NetworkGate connectMessage="Connect MetaMask to finalize.">
            <TxButton
              request={{ address: addresses.oracle, abi: stellarOracleAbi, functionName: 'finalize', args: [BigInt(q.qid)] }}
              errorMessages={ERRORS}
              className="w-full"
            >
              Finalize
            </TxButton>
          </NetworkGate>
        </div>
      ) : null}
    </article>
  )
}
