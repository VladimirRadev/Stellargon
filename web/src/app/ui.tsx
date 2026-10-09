// Small presentational pieces shared by the Stellargon tabs.
import type { ReactNode } from 'react'
import type { Address } from 'viem'
import { iVladTokenAbi } from '../abi'
import { addresses } from '../config/addresses'
import { formatToken } from '../shell/format'
import { TxButton } from '../shell/TxButton'
import { ERRORS, pct, type StateKey } from './stellargon'

const STATE_STYLE: Record<StateKey, { label: string; cls: string; dot: string }> = {
  open: { label: 'Open', cls: 'border-accent-2/40 bg-accent/10 text-accent-2', dot: 'bg-accent-2' },
  closed: { label: 'Closed', cls: 'border-warning/40 bg-warning/10 text-warning', dot: 'bg-warning' },
  resolved: { label: 'Resolved', cls: 'border-lime/40 bg-lime/10 text-lime', dot: 'bg-lime' },
  voided: { label: 'Voided', cls: 'border-border bg-surface-2/70 text-muted', dot: 'bg-muted' },
}

/** Pill with the market state. CLOSED means betting is over and the reporters are deciding the answer. */
export function StateBadge({ state, label }: { state: StateKey; label?: string }) {
  const s = STATE_STYLE[state]
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium ${s.cls}`}>
      <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden />
      {label ?? s.label}
    </span>
  )
}

/** One option with its chance as a big percentage and a bar (Polymarket-style outcome row). */
export function OddsRow({
  label,
  bps,
  pool,
  winner,
  loser,
  size = 'md',
}: {
  label: string
  bps: bigint | undefined
  pool?: bigint
  winner?: boolean
  loser?: boolean
  size?: 'md' | 'lg'
}) {
  const width = bps === undefined ? 0 : Math.min(100, Number(bps) / 100)
  return (
    <div className={loser ? 'opacity-55' : undefined}>
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className={`min-w-0 truncate ${size === 'lg' ? 'text-base' : 'text-sm'} ${winner ? 'font-semibold text-lime' : 'text-text'}`}>
          {winner ? '✓ ' : ''}
          {label}
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          {pool !== undefined ? <span className="font-mono text-xs text-muted">{formatToken(pool, 18, 0)} VLAD</span> : null}
          <span
            className={`font-mono font-semibold tabular-nums ${size === 'lg' ? 'text-2xl' : 'text-lg'} ${winner ? 'text-lime' : 'text-text'}`}
          >
            {pct(bps)}
          </span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{
            width: `${width}%`,
            background: winner ? '#a3e635' : 'linear-gradient(90deg, #10b981, #34d399)',
          }}
        />
      </div>
    </div>
  )
}

/** Decimal amount field with a token label and an optional MAX button. */
export function AmountInput({
  id,
  label,
  value,
  onChange,
  symbol,
  onMax,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  symbol: string
  onMax?: () => void
  hint?: ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="shrink-0 text-sm text-muted">
          {label}
        </label>
        {hint ? <span className="min-w-0 truncate text-xs text-muted">{hint}</span> : null}
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-2xl border border-border bg-bg/60 p-1.5 pl-4 transition focus-within:border-accent-2/60">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.0"
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(',', '.')
            if (/^\d*\.?\d*$/.test(v)) onChange(v)
          }}
          className="min-w-0 flex-1 bg-transparent font-mono text-lg tabular-nums text-text outline-none placeholder:text-muted/50"
        />
        <span className="shrink-0 text-sm font-medium text-muted">{symbol}</span>
        {onMax ? (
          <button
            type="button"
            onClick={onMax}
            className="h-9 shrink-0 rounded-xl border border-border bg-surface-2/70 px-3 font-mono text-xs font-semibold tracking-wider text-muted transition hover:border-accent-2/50 hover:text-text"
          >
            MAX
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Label / value line. */
export function Line({ label, children, tone }: { label: ReactNode; children: ReactNode; tone?: 'good' | 'warn' }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
      <span className="shrink-0 text-muted">{label}</span>
      <span
        className={`min-w-0 truncate text-right font-mono tabular-nums ${
          tone === 'good' ? 'text-accent-2' : tone === 'warn' ? 'text-warning' : 'text-text'
        }`}
      >
        {children}
      </span>
    </div>
  )
}

/** Shows "Approve N VLAD" while the allowance for `spender` is below `need`, then the real action. */
export function ApproveThen({
  spender,
  need,
  allowance,
  disabled,
  children,
}: {
  spender: Address
  need: bigint | undefined
  allowance: bigint | undefined
  disabled?: boolean
  children: ReactNode
}) {
  if (need !== undefined && need > 0n && allowance !== undefined && allowance < need) {
    return (
      <div className="space-y-2">
        <TxButton
          request={{ address: addresses.vladToken, abi: iVladTokenAbi, functionName: 'approve', args: [spender, need] }}
          disabled={disabled}
          errorMessages={ERRORS}
          className="h-12 w-full"
        >
          Approve {formatToken(need)} VLAD
        </TxButton>
        <p className="text-xs text-muted">Step 1 of 2: allow the contract to pull this VLAD. Step 2 appears once it is confirmed.</p>
      </div>
    )
  }
  return <>{children}</>
}

/** Dashed placeholder box for empty lists. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface/30 px-5 py-10 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {children ? <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{children}</div> : null}
    </div>
  )
}

/** Small boxed note (info or warning). */
export function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <p
      className={`rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed ${
        tone === 'warn' ? 'border-warning/30 bg-warning/[0.06] text-warning' : 'border-accent/20 bg-accent/[0.06] text-muted'
      }`}
    >
      {children}
    </p>
  )
}
