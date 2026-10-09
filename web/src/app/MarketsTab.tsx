import { useMemo, useState } from 'react'
import { formatCompact, formatCountdown } from '../shell/format'
import { useNow } from '../shell/useNow'
import { MarketDrawer } from './MarketDrawer'
import { DEPLOYED, oddsOf, stateOf, useMarkets, type Market, type StateKey } from './stellargon'
import { Empty, OddsRow, StateBadge } from './ui'

type Filter = 'all' | StateKey
const FILTERS: readonly { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'voided', label: 'Voided' },
]

export function MarketsTab() {
  const { markets, loading } = useMarkets()
  const now = useNow()
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number>()

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: markets.length, open: 0, closed: 0, resolved: 0, voided: 0 }
    for (const m of markets) c[stateOf(m, now)]++
    return c
  }, [markets, now])

  const shown = markets.filter((m) => {
    if (filter !== 'all' && stateOf(m, now) !== filter) return false
    const s = search.trim().toLowerCase()
    return !s || m.question.toLowerCase().includes(s) || m.options.some((o) => o.toLowerCase().includes(s))
  })
  const current = markets.find((m) => m.id === selected)

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Filter markets" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = f.key === filter
            return (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.key)}
                className={`h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition ${
                  active ? 'border-accent-2/50 bg-accent/15 text-text' : 'border-border bg-surface/60 text-muted hover:text-text'
                }`}
              >
                {f.label}
                {DEPLOYED ? <span className="ml-1.5 font-mono text-xs text-muted">{counts[f.key]}</span> : null}
              </button>
            )
          })}
        </div>
        <label className="relative block sm:w-72">
          <span className="sr-only">Search markets</span>
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="11" cy="11" r="6.5" />
            <path d="m20 20-4.2-4.2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search markets"
            className="h-10 w-full rounded-full border border-border bg-bg/60 pl-10 pr-4 text-sm text-text outline-none transition placeholder:text-muted/60 focus:border-accent-2/60"
          />
        </label>
      </div>

      {!DEPLOYED ? (
        <Empty title="Not deployed yet">Markets appear here once StellarPredict is deployed.</Empty>
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-56 p-5">
              <span className="skeleton h-5 w-3/4" />
              <span className="skeleton mt-3 h-5 w-1/2" />
              <span className="skeleton mt-10 h-4 w-full" />
              <span className="skeleton mt-4 h-4 w-full" />
            </div>
          ))}
        </div>
      ) : markets.length === 0 ? (
        <Empty title="No markets yet">Creators open markets from the Create tab. The first ones will appear here.</Empty>
      ) : shown.length === 0 ? (
        <Empty title="Nothing matches">Try another filter or search term.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((m) => (
            <MarketCard key={m.id} m={m} now={now} onOpen={() => setSelected(m.id)} />
          ))}
        </div>
      )}

      {current ? <MarketDrawer m={current} onClose={() => setSelected(undefined)} /> : null}
    </div>
  )
}

export function MarketCard({ m, now, onOpen }: { m: Market; now: number; onOpen: () => void }) {
  const state = stateOf(m, now)
  const odds = oddsOf(m)
  const rows = m.options.slice(0, 3)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card group flex min-w-0 flex-col p-5 text-left transition hover:border-accent-2/40 hover:shadow-[0_18px_48px_-24px_rgb(16_185_129/0.55)]"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-xs text-muted">#{m.id}</span>
        <StateBadge state={state} />
      </div>
      <h3 className="mt-2 line-clamp-3 break-words font-display text-[1.05rem] font-semibold leading-snug text-text">
        {m.question}
      </h3>
      <div className="mb-4 mt-4 space-y-3">
        {rows.map((label, i) => (
          <OddsRow
            key={i}
            label={label}
            bps={odds[i]}
            winner={state === 'resolved' && m.winner === i}
            loser={state === 'resolved' && m.winner !== i}
          />
        ))}
        {m.options.length > 3 ? <p className="text-xs text-muted">+{m.options.length - 3} more options</p> : null}
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border/70 pt-3 text-xs text-muted">
        <span>
          <span className="font-mono text-text">{formatCompact(m.totalPool)}</span> VLAD pool
        </span>
        <span className="truncate font-mono">
          {state === 'open'
            ? `closes in ${formatCountdown(m.closeTime - now)}`
            : state === 'closed'
              ? now <= m.votingEnd
                ? `vote ends in ${formatCountdown(m.votingEnd - now)}`
                : 'ready to finalize'
              : state === 'resolved'
                ? 'claim open'
                : 'refunds open'}
        </span>
      </div>
    </button>
  )
}
