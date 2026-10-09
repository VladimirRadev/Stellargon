import { useState } from 'react'
import { stellarPredictAbi } from '../abi'
import { addresses } from '../config/addresses'
import { formatDuration, formatTimestamp, formatToken } from '../shell/format'
import { NetworkGate } from '../shell/NetworkGate'
import { TxButton } from '../shell/TxButton'
import { useNow } from '../shell/useNow'
import { useVladBalance } from '../shell/useVladBalance'
import { MarketDrawer } from './MarketDrawer'
import { MarketCard } from './MarketsTab'
import {
  CREATOR_FEE,
  DEPLOYED,
  ERRORS,
  MAX_OPTIONS,
  PREDICT_PLUS_ORACLE_ERRORS_ABI,
  useMarkets,
  useMyCreator,
} from './stellargon'
import { ApproveThen, Empty, Note } from './ui'

const MAX_QUESTION = 280
const MAX_OPTION = 40

/** "YYYY-MM-DDTHH:mm" in local time, for <input type="datetime-local">. */
function toLocalInput(unix: number): string {
  const d = new Date(unix * 1000)
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function CreateTab() {
  return (
    <div className="space-y-8">
      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <div className="card min-w-0 self-start p-5 sm:p-6">
          <p className="eyebrow">Creator status</p>
          <div className="mt-4">
            <NetworkGate connectMessage="Connect MetaMask to check or buy the creator role.">
              <CreatorStatus />
            </NetworkGate>
          </div>
        </div>
        <div className="card min-w-0 p-5 sm:p-6">
          <p className="eyebrow">New market</p>
          <h3 className="mt-2 text-xl font-semibold">Ask a question the world can check</h3>
          <div className="mt-5">
            <CreateForm />
          </div>
        </div>
      </div>
      <MyMarkets />
    </div>
  )
}

function CreatorStatus() {
  const me = useMyCreator()
  const { balance } = useVladBalance()
  if (!DEPLOYED) return <p className="text-sm text-muted">StellarPredict is not deployed yet.</p>
  if (me.loading) return <span className="skeleton h-20 w-full" />
  if (me.isCreator) {
    return (
      <p className="text-sm leading-relaxed">
        <span className="font-semibold text-accent-2">You are a market creator.</span>{' '}
        <span className="text-muted">Fill in the form to open a market.</span>
      </p>
    )
  }
  const short = balance !== undefined && balance < CREATOR_FEE
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted">
        Creating markets needs the creator role. Anyone can buy it once for{' '}
        <span className="font-mono text-text">{formatToken(CREATOR_FEE)} VLAD</span>; the fee goes to the Arena prize
        pool. The admin can also grant it.
      </p>
      {short ? <p className="text-sm text-danger">Your balance is {formatToken(balance)} VLAD.</p> : null}
      <ApproveThen spender={addresses.predict} need={CREATOR_FEE} allowance={me.allowance} disabled={short}>
        <TxButton
          request={{ address: addresses.predict, abi: stellarPredictAbi, functionName: 'applyAsCreator' }}
          disabled={short}
          errorMessages={ERRORS}
          className="h-12 w-full"
        >
          Apply as creator · {formatToken(CREATOR_FEE)} VLAD
        </TxButton>
      </ApproveThen>
    </div>
  )
}

function CreateForm() {
  const now = useNow(30_000)
  const me = useMyCreator()
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['Yes', 'No'])
  const [closeInput, setCloseInput] = useState(() => toLocalInput((Math.floor(Date.now() / 3_600_000) + 1) * 3_600 + 7 * 86_400))
  const [windowDays, setWindowDays] = useState('3')

  const closeTime = Math.floor(new Date(closeInput).getTime() / 1000)
  const windowSecs = Math.round(Number(windowDays) * 86_400)
  const trimmed = options.map((o) => o.trim())

  const problems: string[] = []
  if (question.trim().length < 10) problems.push('Write a question of at least 10 characters.')
  if (trimmed.some((o) => !o)) problems.push('Every option needs a label.')
  if (new Set(trimmed.map((o) => o.toLowerCase())).size !== trimmed.length) problems.push('Options must be different.')
  if (!Number.isFinite(closeTime) || closeTime <= now + 60) problems.push('The close time must be in the future.')
  if (!Number.isFinite(windowSecs) || windowSecs < 3_600) problems.push('The voting window must be at least 1 hour.')

  const setOption = (i: number, v: string) => setOptions((o) => o.map((x, k) => (k === i ? v.slice(0, MAX_OPTION) : x)))
  const reset = () => {
    setQuestion('')
    setOptions(['Yes', 'No'])
  }

  return (
    <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="mk-question" className="text-sm text-muted">
            Question
          </label>
          <span className="font-mono text-xs text-muted">
            {question.length}/{MAX_QUESTION}
          </span>
        </div>
        <textarea
          id="mk-question"
          rows={3}
          value={question}
          maxLength={MAX_QUESTION}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Will ETH/USD close above $3,000 on 2026-11-01 (UTC)? Source: CoinGecko historical data, Close column."
          className="mt-2 w-full resize-y rounded-2xl border border-border bg-bg/60 px-4 py-3 text-sm leading-relaxed text-text outline-none transition placeholder:text-muted/50 focus:border-accent-2/60"
        />
        <p className="mt-1.5 text-xs text-muted">
          Name the public data source and the exact date in the question, so every reporter can check the same number.
        </p>
      </div>

      <fieldset>
        <legend className="text-sm text-muted">
          Options <span className="font-mono text-xs">({options.length}/{MAX_OPTIONS})</span>
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2 rounded-xl border border-border bg-bg/60 py-1 pl-3 pr-1 focus-within:border-accent-2/60">
              <span className="font-mono text-xs text-muted">{i + 1}</span>
              <input
                aria-label={`Option ${i + 1}`}
                value={o}
                onChange={(e) => setOption(i, e.target.value)}
                className="h-9 min-w-0 flex-1 bg-transparent text-sm text-text outline-none"
              />
              {options.length > 2 ? (
                <button
                  type="button"
                  aria-label={`Remove option ${i + 1}`}
                  onClick={() => setOptions((x) => x.filter((_, k) => k !== i))}
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-text"
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {options.length < MAX_OPTIONS ? (
          <button
            type="button"
            className="btn btn-ghost mt-2 min-h-0 py-2 text-sm"
            onClick={() => setOptions((x) => [...x, `Option ${x.length + 1}`])}
          >
            + Add option
          </button>
        ) : null}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="mk-close" className="text-sm text-muted">
            Betting closes (your local time)
          </label>
          <input
            id="mk-close"
            type="datetime-local"
            value={closeInput}
            onChange={(e) => setCloseInput(e.target.value)}
            className="mt-2 h-11 w-full rounded-xl border border-border bg-bg/60 px-3 font-mono text-sm text-text outline-none [color-scheme:dark] focus:border-accent-2/60"
          />
          <p className="mt-1.5 text-xs text-muted">
            {Number.isFinite(closeTime) && closeTime > now
              ? `${new Date(closeTime * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC · in ${formatDuration(closeTime - now)}`
              : '—'}
          </p>
        </div>
        <div>
          <label htmlFor="mk-window" className="text-sm text-muted">
            Reporter voting window (days)
          </label>
          <input
            id="mk-window"
            inputMode="decimal"
            value={windowDays}
            onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setWindowDays(e.target.value)}
            className="mt-2 h-11 w-full rounded-xl border border-border bg-bg/60 px-3 font-mono text-sm text-text outline-none focus:border-accent-2/60"
          />
          <p className="mt-1.5 text-xs text-muted">
            {Number.isFinite(closeTime) && windowSecs > 0
              ? `Votes until ${formatTimestamp(closeTime + windowSecs)}`
              : 'Reporters vote from the close time until the end of this window.'}
          </p>
        </div>
      </div>

      {problems.length > 0 && question.length > 0 ? (
        <ul className="space-y-1 text-sm text-warning">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {me.isCreator === false ? <Note tone="warn">You need the creator role before you can create a market.</Note> : null}

      <NetworkGate connectMessage="Connect MetaMask to create this market.">
      <TxButton
        request={{
          address: addresses.predict,
          abi: PREDICT_PLUS_ORACLE_ERRORS_ABI,
          functionName: 'createMarket',
          args: [question.trim(), trimmed, BigInt(Number.isFinite(closeTime) ? closeTime : 0), BigInt(Math.max(0, windowSecs || 0))],
        }}
        disabled={!DEPLOYED || problems.length > 0 || !me.isCreator}
        errorMessages={ERRORS}
        className="h-12 w-full"
        onConfirmed={reset}
      >
        Create market
      </TxButton>
      </NetworkGate>
      <p className="text-xs text-muted">
        Creating a market is free for creators: the market asks the oracle its question in the same transaction.
      </p>
    </form>
  )
}

function MyMarkets() {
  const { markets } = useMarkets()
  const me = useMyCreator()
  const now = useNow()
  const [selected, setSelected] = useState<number>()
  const mine = me.address ? markets.filter((m) => m.creator.toLowerCase() === me.address!.toLowerCase()) : []
  const current = mine.find((m) => m.id === selected)

  return (
    <section aria-labelledby="my-markets">
      <h3 id="my-markets" className="text-lg font-semibold">
        Markets you created
      </h3>
      <div className="mt-3">
        {!me.address ? (
          <Empty title="Not connected">Connect MetaMask to see the markets you created.</Empty>
        ) : mine.length === 0 ? (
          <Empty title="None yet">Markets you open appear here.</Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mine.map((m) => (
              <MarketCard key={m.id} m={m} now={now} onOpen={() => setSelected(m.id)} />
            ))}
          </div>
        )}
      </div>
      {current ? <MarketDrawer m={current} onClose={() => setSelected(undefined)} /> : null}
    </section>
  )
}
