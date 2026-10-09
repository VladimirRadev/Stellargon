import { useEffect, useState } from 'react'
import { stellarOracleAbi, stellarPredictAbi } from '../abi'
import { addresses } from '../config/addresses'
import { explorerAddressUrl, formatCountdown, formatTimestamp, formatToken, truncateAddress } from '../shell/format'
import { CloseIcon, ExternalIcon } from '../shell/icons'
import { NetworkGate } from '../shell/NetworkGate'
import { TxButton } from '../shell/TxButton'
import { useNow } from '../shell/useNow'
import { useVladBalance } from '../shell/useVladBalance'
import {
  BPS,
  ERRORS,
  FEE_BPS,
  INVALID,
  oddsOf,
  parseAmount,
  payoutPreview,
  pct,
  stateOf,
  toInput,
  useMarketDetail,
  type Market,
} from './stellargon'
import { AmountInput, ApproveThen, Line, Note, OddsRow, StateBadge } from './ui'

/** Market page as a drawer: right-hand panel on desktop, full-screen sheet on phones. */
export function MarketDrawer({ m, onClose }: { m: Market; onClose: () => void }) {
  const now = useNow()
  const state = stateOf(m, now)
  const odds = oddsOf(m)
  const d = useMarketDetail(m)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-labelledby="market-title">
      <button type="button" aria-label="Close market" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-bg shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/70 bg-bg/90 px-5 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs text-muted">Market #{m.id}</span>
            <StateBadge state={state} />
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost size-10 min-h-0 p-0" aria-label="Close">
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="space-y-6 px-5 py-6 sm:px-6">
          <div>
            <h2 id="market-title" className="break-words text-xl font-semibold leading-snug sm:text-2xl">
              {m.question}
            </h2>
            <p className="mt-2 text-xs text-muted">
              Created by{' '}
              <a className="link font-mono" href={explorerAddressUrl(m.creator)} target="_blank" rel="noreferrer">
                {truncateAddress(m.creator)}
              </a>{' '}
              · oracle question #{m.oracleQid.toString()}
            </p>
          </div>

          <div className="space-y-4 rounded-2xl border border-border/80 bg-surface/50 p-4">
            {m.options.map((label, i) => (
              <OddsRow
                key={i}
                label={label}
                bps={odds[i]}
                pool={m.pools[i]}
                size="lg"
                winner={state === 'resolved' && m.winner === i}
                loser={state === 'resolved' && m.winner !== i}
              />
            ))}
          </div>

          <div className="divide-y divide-border/70 border-y border-border/70">
            <Line label="Total pool">{formatToken(m.totalPool)} VLAD</Line>
            <Line label="Betting closes">{formatTimestamp(m.closeTime)}</Line>
            {state === 'open' ? <Line label="Time left">{formatCountdown(m.closeTime - now)}</Line> : null}
            <Line label="Reporter vote ends">{formatTimestamp(m.votingEnd)}</Line>
            <Line label="Fee at resolve">
              {Number(FEE_BPS) / 100}% → Arena prize pool{m.fee > 0n ? ` (${formatToken(m.fee)} VLAD)` : ''}
            </Line>
          </div>

          {state === 'open' ? (
            <section aria-label="Place a bet">
              <p className="eyebrow">Place a bet</p>
              <div className="mt-3">
                <NetworkGate connectMessage="Connect MetaMask to bet VLAD on this market.">
                  <BetForm m={m} allowance={d.allowance} />
                </NetworkGate>
              </div>
            </section>
          ) : (
            <Settlement m={m} state={state} now={now} d={d} />
          )}

          <section aria-label="Your position">
            <p className="eyebrow">Your position</p>
            <div className="mt-3">
              <NetworkGate connectMessage="Connect MetaMask to see your position.">
                <Position m={m} state={state} d={d} />
              </NetworkGate>
            </div>
          </section>

          <a
            className="link inline-flex items-center gap-1 text-sm"
            href={explorerAddressUrl(addresses.predict)}
            target="_blank"
            rel="noreferrer"
          >
            StellarPredict on Blockscout <ExternalIcon />
          </a>
        </div>
      </div>
    </div>
  )
}

function BetForm({ m, allowance }: { m: Market; allowance: bigint | undefined }) {
  const [option, setOption] = useState(0)
  const [input, setInput] = useState('')
  const { balance } = useVladBalance()
  const odds = oddsOf(m)
  const amount = parseAmount(input)
  const tooMuch = amount !== undefined && balance !== undefined && amount > balance
  const payout = amount !== undefined ? payoutPreview(m, option, amount) : undefined
  const newOdds = amount !== undefined ? ((m.pools[option] + amount) * BPS) / (m.totalPool + amount) : undefined
  const multiple = payout !== undefined && amount ? Number((payout * 100n) / amount) / 100 : undefined

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Option" className={`grid gap-2 ${m.options.length > 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2'}`}>
        {m.options.map((label, i) => {
          const active = i === option
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setOption(i)}
              className={`flex min-w-0 items-center justify-between gap-2 rounded-xl border px-3.5 py-3 text-left text-sm font-medium transition ${
                active
                  ? 'border-accent-2/60 bg-accent/15 text-text shadow-[0_0_0_1px_rgb(52_211_153/0.25)]'
                  : 'border-border bg-surface/60 text-muted hover:text-text'
              }`}
            >
              <span className="min-w-0 truncate">{label}</span>
              <span className="shrink-0 font-mono">{pct(odds[i])}</span>
            </button>
          )
        })}
      </div>

      <AmountInput
        id="bet-amount"
        label="Amount"
        value={input}
        onChange={setInput}
        symbol="VLAD"
        onMax={balance !== undefined ? () => setInput(toInput(balance)) : undefined}
        hint={`Balance ${formatToken(balance)} VLAD`}
      />

      <div className="divide-y divide-border/70 rounded-2xl border border-border/80 bg-surface/40 px-4">
        <Line label={`Payout if "${m.options[option]}" wins`} tone="good">
          {payout !== undefined ? `${formatToken(payout)} VLAD` : '—'}
        </Line>
        <Line label="Return on stake">{multiple !== undefined ? `${multiple.toFixed(2)}×` : '—'}</Line>
        <Line label="Odds after your bet">{newOdds !== undefined ? pct(newOdds) : pct(odds[option])}</Line>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Payout = your stake × (total pool − 2% fee) / pool of the winning option, with the pools as they are now plus your
        bet. Later bets change it. Bets cannot be cancelled.
      </p>

      {tooMuch ? <p className="text-sm text-danger">Amount exceeds your VLAD balance.</p> : null}

      <ApproveThen spender={addresses.predict} need={amount} allowance={allowance} disabled={tooMuch}>
        <TxButton
          request={{ address: addresses.predict, abi: stellarPredictAbi, functionName: 'bet', args: [BigInt(m.id), option, amount ?? 0n] }}
          disabled={amount === undefined || tooMuch}
          errorMessages={ERRORS}
          className="h-12 w-full"
          onConfirmed={() => setInput('')}
        >
          {amount !== undefined ? `Bet ${formatToken(amount)} VLAD on “${m.options[option]}”` : 'Enter an amount to bet'}
        </TxButton>
      </ApproveThen>
    </div>
  )
}

type Detail = ReturnType<typeof useMarketDetail>

function Settlement({ m, state, now, d }: { m: Market; state: string; now: number; d: Detail }) {
  if (state === 'resolved') {
    return (
      <Note>
        The oracle answered <span className="font-semibold text-lime">“{m.options[m.winner]}”</span>.{' '}
        {formatToken(m.fee)} VLAD went to the Arena prize pool; winners split the remaining{' '}
        {formatToken(m.totalPool - m.fee)} VLAD in proportion to their stakes on “{m.options[m.winner]}”.
      </Note>
    )
  }
  if (state === 'voided') {
    return (
      <Note tone="warn">
        This market is void:{' '}
        {m.winner === INVALID
          ? 'the reporters tied or nobody voted, so the oracle answer is INVALID.'
          : `nobody bet on the winning option “${m.options[m.winner] ?? m.winner}”.`}{' '}
        No fee was taken. Every bettor can claim back exactly what they bet.
      </Note>
    )
  }

  const votingOpen = now <= m.votingEnd
  const tally = d.oracleVotes
  return (
    <section aria-label="Settlement" className="space-y-3">
      <p className="eyebrow">Settlement</p>
      {d.oracleFinal ? (
        <>
          <p className="text-sm text-muted">
            The oracle finalized the answer{' '}
            <span className="font-semibold text-text">
              {d.oracleWinner === INVALID ? 'INVALID (refunds)' : `“${m.options[d.oracleWinner ?? 0]}”`}
            </span>
            . Anyone can now settle the market.
          </p>
          <NetworkGate connectMessage="Connect MetaMask to settle this market.">
            <TxButton
              request={{ address: addresses.predict, abi: stellarPredictAbi, functionName: 'resolve', args: [BigInt(m.id)] }}
              errorMessages={ERRORS}
              className="h-12 w-full"
            >
              Resolve market
            </TxButton>
          </NetworkGate>
        </>
      ) : votingOpen ? (
        <p className="text-sm leading-relaxed text-muted">
          Betting is closed. Reporters are voting on the answer in the Oracle tab; voting ends in{' '}
          <span className="font-mono text-text">{formatCountdown(m.votingEnd - now)}</span>.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">Voting has ended. Anyone can finalize the oracle question, then resolve.</p>
          <NetworkGate connectMessage="Connect MetaMask to finalize the vote.">
            <TxButton
              request={{ address: addresses.oracle, abi: stellarOracleAbi, functionName: 'finalize', args: [m.oracleQid] }}
              errorMessages={ERRORS}
              className="h-12 w-full"
            >
              Finalize the oracle vote
            </TxButton>
          </NetworkGate>
        </>
      )}
      {tally && !d.oracleFinal ? (
        <p className="font-mono text-xs text-muted">
          Votes so far: {m.options.map((o, i) => `${o} ${tally[i] ?? 0}`).join(' · ')}
        </p>
      ) : null}
    </section>
  )
}

function Position({ m, state, d }: { m: Market; state: string; d: Detail }) {
  const pos = d.position
  const total = pos?.reduce((a, b) => a + b, 0n) ?? 0n
  const settled = state === 'resolved' || state === 'voided'
  return (
    <div className="space-y-3">
      {pos && total > 0n ? (
        <div className="divide-y divide-border/70 rounded-2xl border border-border/80 bg-surface/40 px-4">
          {m.options.map((label, i) =>
            pos[i] && pos[i] > 0n ? (
              <Line key={i} label={label} tone={state === 'resolved' && m.winner === i ? 'good' : undefined}>
                {formatToken(pos[i])} VLAD
              </Line>
            ) : null,
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">You have no bets on this market.</p>
      )}

      {settled && d.claimed ? <Note>You already claimed from this market.</Note> : null}
      {settled && !d.claimed && d.claimable !== undefined && d.claimable > 0n ? (
        <TxButton
          request={{ address: addresses.predict, abi: stellarPredictAbi, functionName: 'claim', args: [BigInt(m.id)] }}
          errorMessages={ERRORS}
          className="h-12 w-full"
        >
          {state === 'voided' ? 'Claim refund of' : 'Claim'} {formatToken(d.claimable)} VLAD
        </TxButton>
      ) : null}
      {state === 'resolved' && total > 0n && d.claimable === 0n && !d.claimed ? (
        <p className="text-sm text-muted">Your option did not win, so there is nothing to claim.</p>
      ) : null}
      {!settled && pos && pos[0] !== undefined && total > 0n ? (
        <p className="text-xs text-muted">
          If your best option wins you receive about{' '}
          {formatToken(
            pos.reduce((best, s, i) => {
              const pool = m.pools[i] ?? 0n
              if (pool === 0n) return best
              const p = (s * ((m.totalPool * (BPS - FEE_BPS)) / BPS)) / pool
              return p > best ? p : best
            }, 0n),
          )}{' '}
          VLAD at the current pools ({formatToken(total)} VLAD staked).
        </p>
      ) : null}
    </div>
  )
}
