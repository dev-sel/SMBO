// Every event as a sentence someone in the control room would say out loud. Decisions are the
// only thing in brand orange, because orange means "this needs you".

import { clock } from "./engine.js";

// what each report is about, to say "the report about the orange flash"
const ABOUT = {
  SYN_REPORT_02: "the fallen branch",
  SYN_REPORT_03: "the protection trip",
  SYN_REPORT_04: "the orange flash",
  SYN_REPORT_05: "the ticking and warm spot",
  SYN_REPORT_06: "the swinging span",
};
export const REPORT = Object.fromEntries(Object.entries(ABOUT).map(([rid, about]) =>
  [rid, `${about[4].toUpperCase()}${about.slice(5)} (${rid.replace("SYN_REPORT_", "R")})`]));

const FOUND = {
  tree: (pkg, span) => `${pkg} spots a tree lying on ${span}.`,
  damage: (pkg, span) => `${pkg}'s thermal camera finds a hot joint on ${span}.`,
  clearance: (pkg, span) => `${pkg} measures a wire hanging too low on ${span}.`,
};
export const FAULT = { tree: "tree on the wire", damage: "damaged joint", clearance: "wire too low" };

export const pct = (p) => (p < 0.005 ? "under 1 %" : p > 0.995 ? "over 99 %" : `${Math.round(p * 100)} %`);
export const spanName = (id) => id.replace("/", " span ");
const runName = (run) => {
  const [line, a] = run[0].split("/");
  const b = run.at(-1).split("/")[1];
  return run.length === 1 ? `${line} span ${a}` : `${line}, spans ${a} to ${b}`;
};
export function substationName(data, id) {
  const name = data.nodes.features.find((f) => f.properties.id === id)?.properties.name;
  return name ? name.replace(/^(Umspannwerk|UW) /, "") : id;
}

// each report as it came in, before the packages could fly
const ARRIVED = {
  SYN_REPORT_01: "The weather desk warns of strong gusts across the whole area (R01).",
  SYN_REPORT_02: "A caller reports a fallen branch and trees brushing a line (R02).",
  SYN_REPORT_03: "A protection trip is logged, and LINE_024 is switched off as a precaution (R03).",
  SYN_REPORT_04: "A resident saw an orange flash near an industrial site (R04).",
  SYN_REPORT_05: "An observer heard ticking and saw a warm spot on a line (R05).",
  SYN_REPORT_06: "A span was seen swinging more than its neighbours (R06).",
};
const two = (v) => v.toFixed(2);

// what made a drone in the air change its plan
function because(news, params) {
  if (!news) return "Something changed since it took off.";
  if (news.outcome === "found" && news.after < params.dispatchAt) return `Since it took off, a reading on ${spanName(news.span)} hinted at a ${FAULT[news.fault]}.`;
  if (news.outcome === "found") return `Since it took off, a ${FAULT[news.fault]} turned up on ${spanName(news.span)}.`;
  if (news.outcome === "unclear") return `Since it took off, arcing was heard on ${news.line}.`;
  if (news.kind === "switch") return `Since it took off, ${news.line} was switched back on.`;
  if (news.outcome === "dead") return `Since it took off, ${news.line} turned out to be dead.`;
  return `Since it took off, ${news.line} turned out to be live after the trip.`;
}

// tone is one of decision, finding, unclear, clear, move, info
export function describe(e, data, params) {
  switch (e.kind) {
    case "storm":
      return { tone: "info", title: "The storm's strongest gust passes, 33 m/s from the south-west.",
               detail: "The five drones wait it out clamped to lines at substations. Nothing can fly until the gusts drop under 10 m/s." };
    case "report": {
      const area = data.areas.features.find((f) => f.properties.id === e.report)?.properties;
      return { tone: "report", title: ARRIVED[e.report], detail: `Rated ${area.confidence}. ${area.text.replace(/^SYNTHETIC (.)/, (_, c) => c.toUpperCase())}` };
    }
    case "start":
      return {
        tone: "info",
        title: "Two hours after the storm. The reports are in, and it's calm enough to fly.",
        detail: `The five drones sat out the storm on substations: ${e.standby.map((s) => `${s.pkg} at ${substationName(data, s.substation)}`).join(", ")}. They all have full batteries. We picked these 5 of the ${e.sites} substations with the k-medoids algorithm: from here the average flight to where storms bring trees down is ${e.avgMinutes.toFixed(1)} minutes, the shortest of any choice. Turn on "Who covers what" on the map to see each drone's area.`,
      };
    case "line":
      if (e.outcome === "dead" && e.was === "doubt") {
        return { tone: "finding", title: `${e.pkg} flies past ${e.line} and finds no voltage on it.`,
                 detail: "It's inside the area of the protection trip (R03), so it has most likely locked out. Something is probably still lying on it." };
      }
      if (e.outcome === "dead") return { tone: "finding", title: `${e.pkg} lands on ${e.line} but won't charge. The line is dead.`,
        detail: `Nobody had switched ${e.line} off, so it probably tripped on something and goes on the search list. ${e.pkg} uses its spare battery to reach the next line and charge there.` };
      return { tone: "info", title: `${e.line} is live.`, detail: e.how === "clamped on" ? `${e.pkg} is charging on it.` : `${e.pkg} picked up its voltage flying past.` };
    case "look": {
      const span = spanName(e.span);
      // one sighting of something nobody expected stays unclear: 60 % detection over 1 % false
      // alarm multiplies the odds by 60, which takes 0.3 % to 15 %, not to a crew
      if (e.outcome === "found" && e.after < params.dispatchAt) {
        return { tone: "unclear", title: `${e.pkg} sees what could be a ${FAULT[e.fault]} on ${span}. One reading isn't enough.`,
                 detail: `It takes the chance from ${pct(e.before)} to ${pct(e.after)}, short of the ${pct(params.dispatchAt)} we want before sending a crew. Every drone that can reach it now weighs a second look.` };
      }
      if (e.outcome === "found") {
        return { tone: "finding", title: FOUND[e.fault](e.pkg, span),
                 detail: `Before this we put the chance of a ${FAULT[e.fault]} here at ${pct(e.before)}. Now it's ${pct(e.after)}.` };
      }
      const how = e.mode === "patrol" ? `${e.pkg} flew over it` : `${e.pkg} had a look from its perch`;
      return { tone: "clear", title: `Nothing on ${span}.`,
               detail: `${how}. Cameras miss things too, so we drop the chance of a ${FAULT[e.fault]} from ${pct(e.before)} to ${pct(e.after)} rather than to zero.` };
    }
    case "listen":
      if (e.outcome === "unclear") {
        return { tone: "unclear", title: `${e.pkg} picks up arcing in ${e.line}'s current.`,
                 detail: `It could be a cracked joint, or just wet insulators, and it doesn't say where. We now think there's a ${pct(e.after)} chance something on ${e.line} is damaged, up from ${pct(e.before)}. Not enough for a crew, enough for a closer look.` };
      }
      return { tone: "clear", title: `No arcing on ${e.line}.`, detail: `${e.pkg} would hear arcing anywhere along the line while it charges.` };
    case "call":
      return e.outcome === "generator"
        ? { tone: "clear", title: "We phone the industrial site about the orange flash. Their log shows a generator test at T+1:02.",
            detail: "That explains the flash, so nobody needs to fly there." }
        : { tone: "unclear", title: "We phone the industrial site about the orange flash. Their log shows nothing at that time.",
            detail: "So the flash could still have been a fault on the grid." };
    case "flight": {
      if (e.retask) {
        const where = e.witness ? `stay on ${spanName(e.landing)}, which is dead` : `land on ${spanName(e.landing)} to charge`;
        return {
          tone: "move",
          title: e.sameRun ? `${e.pkg} keeps going, but will now ${where}.`
            : `${e.pkg} changes plan in the air: ${e.run.length ? `it will check ${runName(e.run)} and ${where}` : where}.`,
          detail: `${because(e.because, params)} So it planned again from where it is, with ${Math.round(e.left)} minutes of flying left, and this is now the best use of them.`,
        };
      }
      const target = e.why[0]?.value >= 0.005 ? `It's mainly after ${spanName(e.why[0].span)}, the likeliest spot.` : "";
      const end = e.witness
        ? `Then it stays on ${spanName(e.landing)}. That line is dead, so it can't charge until the line comes back on.`
        : e.cover >= 0.02 ? `Then it charges on ${spanName(e.landing)}, near risk no other drone covers.`
        : `Then it lands on ${spanName(e.landing)} to charge.`;
      const rival = [...e.rivals].sort((a, b) => b.value - a.value)[0];
      const chosen = rival ? ` Its flight is worth ${two(e.search ?? e.value)} faults found, the best of the drones ready. Next was ${rival.pkg} at ${two(rival.value)}.` : "";
      // barely anything to find on the way: the flight is about where it waits
      const reposition = !e.run.length || e.runValue < 0.05;
      return {
        tone: "move",
        title: reposition ? `${e.pkg} moves to ${spanName(e.landing)} to cover the network better.` : `${e.pkg} takes off to check ${runName(e.run)}.`,
        detail: `${target} ${end}${chosen} About ${Math.round(e.arrive - e.depart)} minutes in the air, ${params.reserveMin} minutes of battery kept spare.`.trim(),
      };
    }
    case "land":
      return e.witness
        ? { tone: "move", title: `${e.pkg} settles on ${spanName(e.span)} and waits.`,
            detail: `${e.witness} is dead, so it can't charge here. When the line is switched back on, ${e.pkg} will be the first to know whether it holds.` }
        : { tone: "move", title: `${e.pkg} lands on ${spanName(e.span)} and starts charging.`,
            detail: `It can fly again at ${clock(e.readyAt)}. Until then it watches the spans around it and listens for arcing along the line.` };
    case "hold":
      return { tone: "info", title: `${e.pkg} stays where it is.`,
               detail: "Nothing within reach is worth three hours of charging. With a full battery it can react to the next thing we find." };
    case "decision":
      if (e.action === "dispatch") return { tone: "decision", title: `Send a crew to ${spanName(e.span)} (${FAULT[e.fault]}).`, detail: `We're ${pct(e.p)} sure. Our bar for a crew is ${pct(params.dispatchAt)}.` };
      if (e.action === "repair") return { tone: "decision", title: `Keep ${e.line} off until the crew has cleared it.`, detail: "Switching it on now would put the fault straight back on the grid." };
      if (e.action === "reenergize") return { tone: "decision", title: `Switch ${e.line} back on.`, detail: `We put the chance of a fault still on it at ${pct(e.p)}, under our ${pct(params.reenergizeBelow)} bar for trying. If it trips, the protection cuts it within a fraction of a second.` };
      return { tone: "decision", title: `Close the report about ${ABOUT[e.report]} (${e.report.replace("SYN_REPORT_", "R")}).`, detail: `There's now only a ${pct(e.p)} chance it points to a fault we haven't found.` };
    case "switch":
      return e.outcome === "live"
        ? { tone: "clear", title: `${e.line} is back on, and it holds.`,
            detail: e.witnesses.length ? `${e.witnesses.join(" and ")} feels the current come back and starts charging.` : "Its customers have power again, and drones can charge on it from now on." }
        : { tone: "finding", title: `${e.line} trips again when it's switched on.`, detail: `${e.witnesses.join(" and ") || "No drone"} recorded the fault current, so something is still on the line. Back to searching it.` };
    case "stranded":
      return { tone: "finding", title: `${e.pkg} is stuck on ${spanName(e.span)}.`, detail: "There's no live line within reach of its spare battery. It waits for the line to come back." };
    case "end":
      return { tone: "info", title: "That's the four hours.", detail: "The panel on the right shows what's done and what's still open." };
    default:
      return { tone: "info", title: e.kind };
  }
}

// the moments that move the story; the rest are behind "Everything"
export const routine = (e) => (e.kind === "line" && e.outcome === "live") || (e.kind === "listen" && e.outcome === "clear")
  || (e.kind === "look" && e.outcome === "clear") || e.kind === "hold" || (e.kind === "flight" && e.sameRun);
