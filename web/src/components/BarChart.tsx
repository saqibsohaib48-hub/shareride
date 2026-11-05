'use client';
/** Minimal accessible SVG bar chart (no chart library). Values are plotted on a zero baseline. */
export function BarChart({ data, label, format = String, color = 'var(--brand)' }: { data: { x: string; y: number }[]; label: string; format?: (n: number) => string; color?: string }) {
  const W = 640, H = 180, padB = 22, padT = 16;
  const max = Math.max(1, ...data.map((d) => d.y));
  const bw = W / Math.max(1, data.length);
  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="small" style={{ fontWeight: 700, marginBottom: 6 }}>{label}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${label}: ${data.map((d) => `${d.x} ${format(d.y)}`).join(', ')}`}>
        <line x1="0" x2={W} y1={H - padB} y2={H - padB} stroke="var(--line)" />
        {data.map((d, i) => {
          const h = ((H - padB - padT) * d.y) / max;
          return (
            <g key={d.x}>
              <rect x={i * bw + bw * 0.15} y={H - padB - h} width={bw * 0.7} height={Math.max(0, h)} rx="3" fill={color}><title>{`${d.x}: ${format(d.y)}`}</title></rect>
              {(data.length <= 14 || i % Math.ceil(data.length / 10) === 0) && <text x={i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--ink-3)">{d.x.slice(5)}</text>}
            </g>
          );
        })}
        <text x="4" y="12" fontSize="11" fill="var(--ink-3)">{format(max)}</text>
      </svg>
    </figure>
  );
}
