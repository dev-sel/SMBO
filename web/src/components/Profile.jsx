// Walking the span from its first tower to its second: the ground, the tallest canopy inside
// the 15 m strip and within 50 m, and a mark wherever canopy could reach the wire.

export default function Profile({ profile, height = 140 }) {
  const { ground, strip, near, reaching, step } = profile;
  const width = 600;
  const n = ground.length;
  const known = [...ground, ...strip, ...near].filter((v) => v !== null);
  const lo = Math.min(...known) - 2;
  const hi = Math.max(...known) + 2;
  const x = (i) => (i / (n - 1)) * width;
  const y = (v) => height - ((v - lo) / (hi - lo)) * (height - 10) - 5;
  // hold the last value over a gap, one null in a path voids the whole shape
  const held = (list) => {
    let last = list.find((v) => v !== null) ?? lo;
    return list.map((v) => (v === null ? last : (last = v)));
  };
  const line = (list) => "M " + held(list).map((v, i) => `${x(i)} ${y(v)}`).join(" L ");

  return (
    <figure className="profile">
      <svg viewBox={`0 0 ${width} ${height + 14}`} width="100%" role="img" aria-label="Ground and canopy along the span">
        <path d={`${line(ground)} L ${width} ${height} L 0 ${height} Z`} fill="var(--raised)" stroke="var(--muted)" strokeWidth="1" />
        <path d={line(near)} fill="none" stroke="#7bbf6a" strokeOpacity="0.45" strokeWidth="1.4" strokeDasharray="4 3" />
        <path d={line(strip)} fill="none" stroke="#7bbf6a" strokeWidth="1.8" />
        {reaching.map((hit, i) => hit && (
          <rect key={i} x={x(i) - width / n / 2} y={height + 6} width={Math.max(width / n, 2)} height="6" fill="#8f7ae0" />
        ))}
        <text x="4" y="12" fill="var(--muted)" fontSize="12">{Math.round(hi)} m</text>
        <text x="4" y={height - 4} fill="var(--muted)" fontSize="12">{Math.round(lo)} m</text>
        <text x={width - 4} y={height - 4} textAnchor="end" fill="var(--muted)" fontSize="12">{Math.round((n - 1) * step)} m along</text>
      </svg>
      <figcaption className="sub">
        Walking along the span: the ground in grey, the tallest trees within 15 m in green (dashed: within 50 m). The violet marks show where a tree could reach the wire.
      </figcaption>
    </figure>
  );
}
