import type { ReactNode } from "react";

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

export function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="section-title">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
    </div>
  );
}
