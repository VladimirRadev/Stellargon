import { useState } from 'react'
import { addresses } from '../config/addresses'
import { explorerAddressUrl, formatCompact, formatToken } from '../shell/format'
import { ExternalIcon, StarGlyph } from '../shell/icons'
import { getSite } from '../shell/sites'
import { StatTile } from '../shell/StatTile'
import { Tabs } from '../shell/Tabs'
import { useNow } from '../shell/useNow'
import { CreateTab } from './CreateTab'
import { MarketsTab } from './MarketsTab'
import { OracleTab } from './OracleTab'
import { CREATOR_FEE, DEPLOYED, FEE_BPS, QUESTION_FEE, REPORTER_STAKE, SLASH_BPS, stateOf, useMarkets, useReporters } from './stellargon'

type TabKey = 'markets' | 'oracle' | 'create'
const TABS = [
  { key: 'markets', label: 'Markets' },
  { key: 'oracle', label: 'Oracle' },
  { key: 'create', label: 'Create' },
] as const satisfies readonly { key: TabKey; label: string }[]

const TAB_TITLES: Record<TabKey, { eyebrow: string; title: string }> = {
  markets: { eyebrow: 'Markets', title: 'Bet on what happens next' },
  oracle: { eyebrow: 'Oracle', title: 'Reporters decide the answers' },
  create: { eyebrow: 'Create', title: 'Open a new market' },
}

export function StellargonApp() {
  const [tab, setTab] = useState<TabKey>('markets')
  const open = (key: TabKey) => {
    setTab(key)
    document.getElementById('stellargon')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="space-y-12 sm:space-y-16">
      {!DEPLOYED ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/[0.06] px-4 py-3 text-sm text-warning">
          StellarOracle and StellarPredict are not deployed yet. Their addresses in{' '}
          <code className="font-mono">config/addresses.ts</code> are placeholders, so on-chain reads are switched off.
        </div>
      ) : null}

      <section className="grid items-start gap-8 lg:grid-cols-[1.15fr_1fr] lg:gap-10">
        <div className="min-w-0 pt-2">
          <p className="eyebrow inline-flex items-center gap-2">
            <StarGlyph size={12} /> Stellar suite · prediction market
          </p>
          <h1 className="mt-4 text-5xl font-bold leading-[1.02] sm:text-6xl lg:text-7xl">
            Stellar
            <span className="bg-gradient-to-r from-lime via-accent-2 to-accent bg-clip-text text-transparent">gon</span>
          </h1>
          <p className="mt-4 max-w-xl font-display text-xl leading-snug text-text/90 sm:text-2xl">
            Predict real-world events. Stake $VLAD. Settled by a reporter vote.
          </p>
          <p className="mt-3 text-sm text-muted">A Polymarket-style clone built for Stellar and $VLAD</p>
          <div className="mt-6 flex flex-wrap gap-2">
            {['PARIMUTUEL', 'HUMAN ORACLE', '2% TO THE ARENA POOL'].map((c) => (
              <span key={c} className="chip font-mono text-xs tracking-[0.12em]">
                <span className="size-1.5 rounded-full bg-accent-2" aria-hidden />
                {c}
              </span>
            ))}
          </div>
          <div className="mt-7 flex flex-wrap gap-3">
            <button type="button" className="btn btn-primary" onClick={() => open('markets')}>
              Browse markets
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => open('oracle')}>
              Become a reporter
            </button>
          </div>
        </div>
        <Lifecycle />
      </section>

      <Stats />

      <section id="stellargon" aria-label="Stellargon" className="scroll-mt-28">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">{TAB_TITLES[tab].eyebrow}</p>
            <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">{TAB_TITLES[tab].title}</h2>
          </div>
          <Tabs tabs={TABS} value={tab} onChange={setTab} label="Stellargon sections" />
        </div>
        <div className="mt-6" role="tabpanel">
          {tab === 'markets' ? <MarketsTab /> : tab === 'oracle' ? <OracleTab /> : <CreateTab />}
        </div>
      </section>

      <HowItWorks />
    </div>
  )
}

const STEPS: readonly { title: string; text: string }[] = [
  { title: 'Bet', text: 'Put VLAD on any option until the market closes. Prices are the pool shares.' },
  { title: 'Close', text: 'At the close time betting stops and the oracle question opens for votes.' },
  { title: 'Vote', text: 'Staked reporters vote on what happened, citing the source named in the question.' },
  { title: 'Resolve', text: '2% of the pool goes to the Arena prize pool; the rest belongs to the winners.' },
  { title: 'Claim', text: 'Winners claim pro rata. A tie or no votes means refunds for everyone.' },
]

function Lifecycle() {
  return (
    <div className="card overflow-hidden p-5 sm:p-7">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-accent/20 blur-3xl" />
      <p className="eyebrow">Life of a market</p>
      <ol className="relative mt-5 space-y-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative flex gap-4">
            {i < STEPS.length - 1 ? (
              <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px bg-gradient-to-b from-accent-2/50 to-border" />
            ) : null}
            <span className="grid size-8 shrink-0 place-items-center rounded-full border border-accent-2/40 bg-accent/10 font-mono text-xs font-semibold text-accent-2">
              {i + 1}
            </span>
            <div className="min-w-0 pb-1">
              <p className="font-display font-semibold">{s.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-muted">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Stats() {
  const { markets, count, loading } = useMarkets()
  const { reporters, loading: rLoading } = useReporters()
  const now = useNow(15_000)
  const volume = markets.reduce((a, m) => a + m.totalPool, 0n)
  const openCount = markets.filter((m) => stateOf(m, now) === 'open').length
  const hint = DEPLOYED ? undefined : 'not deployed yet'
  return (
    <section aria-label="Stellargon statistics" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatTile label="Markets" value={DEPLOYED && count !== undefined ? count.toString() : '—'} loading={loading} hint={hint ?? `${openCount} open`} />
      <StatTile
        label="Volume"
        value={DEPLOYED ? formatCompact(volume) : '—'}
        unit={DEPLOYED ? 'VLAD' : undefined}
        loading={loading}
        hint={hint ?? 'VLAD bet in all loaded markets'}
        highlight
      />
      <StatTile label="Reporters" value={DEPLOYED ? reporters.length.toString() : '—'} loading={rLoading} hint={hint ?? `${formatToken(REPORTER_STAKE)} VLAD stake each`} />
      <StatTile label="Market fee" value={`${Number(FEE_BPS) / 100}%`} hint="to the Arena prize pool" />
    </section>
  )
}

const FORMULAS: readonly { name: string; formula: string }[] = [
  { name: 'Implied odds of an option', formula: 'option pool / total pool' },
  { name: 'Fee at resolve', formula: 'total pool × 2% → Arena prize pool' },
  { name: 'Winner payout', formula: 'your stake on the winner × (total pool − fee) / winning pool' },
  { name: 'Voided market (INVALID or no winning bets)', formula: 'refund = everything you bet, no fee' },
  { name: 'Slash per minority reporter', formula: 'stake × 10%, split equally among majority voters' },
]

function HowItWorks() {
  const arena = getSite('arena')
  return (
    <section aria-labelledby="how-it-works" className="card overflow-hidden p-5 sm:p-7">
      <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:gap-10">
        <div className="min-w-0">
          <p className="eyebrow">How it works</p>
          <h2 id="how-it-works" className="mt-2 text-2xl font-semibold sm:text-3xl">
            Parimutuel pools, human oracle
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Every option of a market has its own pool of VLAD. There is no order book and no fixed price: when the answer
            is known, the people who bet on it split everyone else's money in proportion to their stakes. The pool shares
            before the close are the crowd's implied probabilities.
          </p>
          <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { k: 'Fee', v: `${Number(FEE_BPS) / 100}%`, d: 'of each pool' },
              { k: 'Stake', v: formatToken(REPORTER_STAKE), d: 'VLAD per reporter' },
              { k: 'Slash', v: `${Number(SLASH_BPS) / 100}%`, d: 'of a minority stake' },
            ].map((p) => (
              <div key={p.k} className="min-w-0 rounded-2xl border border-border/80 bg-bg/40 p-3 sm:p-4">
                <p className="eyebrow truncate">{p.k}</p>
                <p className="mt-1 font-mono text-xl font-semibold text-accent-2 sm:text-2xl">{p.v}</p>
                <p className="mt-0.5 text-xs leading-snug text-muted">{p.d}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm leading-relaxed text-muted">
            Fee flow: the 2% market fee, the {formatToken(CREATOR_FEE)} VLAD creator application and the{' '}
            {formatToken(QUESTION_FEE)} VLAD fee for stand-alone oracle questions are plain VLAD transfers to the{' '}
            <a className="link" href={arena.url} target="_blank" rel="noreferrer">
              Stellar Arena
            </a>{' '}
            prize pool, which pays Arena players.
          </p>
          <p className="mt-4 rounded-xl border border-warning/30 bg-warning/[0.06] px-3.5 py-3 text-sm leading-relaxed text-warning">
            Trust model: this is a human-voted demo oracle, not UMA or Chainlink. Nothing on chain checks the real world. A
            majority of voting reporters can finalize a wrong answer, and the admin can add reporters without a stake.
            Testnet VLAD only.
          </p>
          {DEPLOYED ? (
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <a className="link inline-flex items-center gap-1" href={explorerAddressUrl(addresses.predict)} target="_blank" rel="noreferrer">
                StellarPredict <ExternalIcon />
              </a>
              <a className="link inline-flex items-center gap-1" href={explorerAddressUrl(addresses.oracle)} target="_blank" rel="noreferrer">
                StellarOracle <ExternalIcon />
              </a>
            </div>
          ) : null}
        </div>

        <dl className="min-w-0 divide-y divide-border/70 self-start rounded-2xl border border-border/80 bg-bg/40">
          {FORMULAS.map((f) => (
            <div key={f.name} className="px-4 py-3">
              <dt className="text-xs text-muted">{f.name}</dt>
              <dd className="mt-1 break-words font-mono text-sm text-text">{f.formula}</dd>
            </div>
          ))}
          <div className="px-4 py-3">
            <dt className="text-xs text-muted">Worked example</dt>
            <dd className="mt-1 text-sm leading-relaxed text-text">
              Alice bets 30 and Bob 10 VLAD on Yes; Carol bets 60 on No. Yes wins. The fee is 2 VLAD, so 98 VLAD go to the
              Yes side: Alice receives 30 × 98 / 40 = 73.5 VLAD and Bob 24.5 VLAD.
            </dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
