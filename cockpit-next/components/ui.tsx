// UI primitives — thin React wrappers over the canonical CSS classes.
import { chf } from "@/lib/money";

export type Accent = "ok" | "danger" | "warn" | "info" | "owner" | null;

export function Stat({ label, value, mod = null, hint }: {
  label: string; value: string; mod?: Accent; hint?: React.ReactNode;
}) {
  return (
    <div className={`stat${mod ? ` stat--${mod}` : ""}`}>
      <div className="stat__head"><span className="stat__label">{label}</span></div>
      <div className={`stat__value${mod ? ` stat__value--${mod}` : ""}`}>{value}</div>
      {hint && <div className="stat__hint">{hint}</div>}
    </div>
  );
}

export function Chip({ mod, children }: { mod?: Accent | "count"; children: React.ReactNode }) {
  return <span className={`chip chip--sm${mod ? ` chip--${mod}` : ""}`}>{children}</span>;
}

export function Meter({ pct, mod }: { pct: number; mod?: "ok" | "warn" | "danger" }) {
  return (
    <div className="meter">
      <div className={`meter__bar${mod ? ` meter__bar--${mod}` : ""}`}
           style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

export function Money({ v }: { v: number | null | undefined }) {
  return <span className="money">{chf(v)}</span>;
}

export function ChartCard({ title, legend, height = 320, children }: {
  title: string; legend?: React.ReactNode; height?: number; children: React.ReactNode;
}) {
  return (
    <div className="chart-card">
      <div className="chart-card__head">
        <h3 style={{ margin: 0 }}>{title}</h3>
        {legend}
      </div>
      <div className="chart-wrap" style={{ height }}>{children}</div>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <div className="chart-legend">
      {items.map(i => (
        <span key={i.label}>
          <span className={`chart-legend__sw${i.line ? " chart-legend__sw--line" : ""}`}
                style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function RecapTile({ href, label, value, mod, chip, hint, meter }: {
  href: string; label: string; value: string; mod?: Accent;
  chip?: React.ReactNode; hint?: React.ReactNode;
  meter?: { pct: number; mod?: "ok" | "warn" | "danger" };
}) {
  return (
    <a href={href} className="recap">
      <div className="recap__head">
        <span className="recap__label">{label}</span>
        <span className="row-split">{chip}</span>
      </div>
      <div className={`recap__value${mod ? ` recap__value--${mod}` : ""}`}>{value}</div>
      {meter && <Meter pct={meter.pct} mod={meter.mod} />}
      {hint && <div className="recap__hint">{hint}</div>}
    </a>
  );
}
