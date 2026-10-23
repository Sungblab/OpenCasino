import type { ReactNode } from "react";

export function AdminView({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return <section className="admin-view"><div className="admin-view-heading"><h1>{title}</h1>{meta && <span>{meta}</span>}</div>{children}</section>;
}

export function AdminPanelHeading({ title, note, action }: { title: string; note?: string; action?: ReactNode }) {
  return <div className="admin-panel-heading"><h2>{title}</h2>{action ?? <span>{note}</span>}</div>;
}

export function AdminKpi({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <div className={`admin-kpi ${tone}`}><small>{label}</small><strong>{value}</strong></div>;
}

export function Metric({ label, value }: { label: string; value: string }) {
  return <div className="admin-metric"><small>{label}</small><strong>{value}</strong></div>;
}
