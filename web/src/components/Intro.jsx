// The first screen: the problem in one line, our answer in four, and two ways in.

const STEPS = [
  ["Measure", "Camera, thermal and the line's own current"],
  ["Rank", "Tall trees, storm wind and six reports"],
  ["Adapt", "Every reading re-plans every drone"],
  ["Act", "A crew at 80 %, power back under 25 %"],
];

export default function Intro({ onPlay, onExplore }) {
  return (
    <div className="intro" role="dialog" aria-modal="true" aria-labelledby="intro-title">
      <div className="intro-card">
        <p className="eyebrow">Nomadic challenge · Keeping the Power Flowing</p>
        <h1 id="intro-title">Where five drones should look after a storm</h1>
        <p className="lead">A storm hit 64 power lines near Augsburg. SMBO plans where five line-charging drones fly
          and tells the operator when to send a crew.</p>
        <ol className="steps">
          {STEPS.map(([title, text], i) => (
            <li key={title}><span className="step-n num">{i + 1}</span><b>{title}</b><span>{text}</span></li>
          ))}
        </ol>
        <div className="actions">
          <button className="play" onClick={onPlay} autoFocus>Play the walk-through</button>
          <button className="quiet" onClick={onExplore}>Explore on my own</button>
        </div>
        <p className="fine">30 minutes of flight, 3 hours to charge, only on a live line. The grid, trees and wind are real. The storm and reports are made up.</p>
      </div>
    </div>
  );
}
