// Orbs for NavAIgate Workspace.
//   LogoOrb     the NavAIgate ribbon-N inside a glass sphere with a turning gold
//               halo, drifting light and orbiting points. It speeds up while
//               agents are working and pulses with Savvy's voice.
//   HarnessOrb  one subscription: liquid fill = this week's (or this month's)
//               use, outer ring = the current session, glow while working.
// Pure CSS and SVG; keyframes are injected once.
import type { CSSProperties, ReactNode } from "react";
import { NavMark } from "./navmark";

const CSS = `
@keyframes nav-orb-spin { to { transform: rotate(360deg) } }
@keyframes nav-orb-breathe { 0%,100% { transform: scale(1) } 50% { transform: scale(1.035) } }
@keyframes nav-orb-drift-a { 0%,100% { transform: translate(-18%,-10%) } 50% { transform: translate(14%,12%) } }
@keyframes nav-orb-drift-b { 0%,100% { transform: translate(16%,14%) } 50% { transform: translate(-12%,-16%) } }
@keyframes nav-orb-pulse { 0% { transform: scale(1); opacity: .55 } 100% { transform: scale(1.38); opacity: 0 } }
@keyframes nav-orb-wave { from { transform: translateX(0) } to { transform: translateX(-50%) } }
@keyframes nav-orb-glow { 0%,100% { opacity: .45 } 50% { opacity: 1 } }
.nav-orb * { box-sizing: border-box }
@media (prefers-reduced-motion: reduce) { .nav-orb, .nav-orb * { animation-duration: 0s !important; animation-iteration-count: 1 !important } }
`;
let injected = false;
function inject() {
  if (injected || typeof document === "undefined") return;
  const el = document.createElement("style");
  el.dataset.navOrb = "1";
  el.textContent = CSS;
  document.head.appendChild(el);
  injected = true;
}

const GOLD = "#D4A354";
const abs: CSSProperties = { position: "absolute", inset: 0, borderRadius: "50%" };

export type OrbMood = "idle" | "busy" | "listening" | "speaking" | "connecting";

export function LogoOrb({ size = 96, mood = "idle", onClick, title }: { size?: number; mood?: OrbMood; onClick?: () => void; title?: string }) {
  inject();
  const busy = mood === "busy";
  const voice = mood === "speaking" || mood === "listening";
  const spin = busy ? "3.2s" : mood === "speaking" ? "2.4s" : "11s";
  const small = size < 40;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      aria-label={title ?? "NavAIgate"}
      className="nav-orb"
      style={{ position: "relative", width: size, height: size, flex: "none", padding: 0, border: 0, background: "transparent", cursor: onClick ? "pointer" : "default" }}
    >
      {/* voice ripples */}
      {voice || mood === "connecting"
        ? [0, 0.6].map((d) => (
            <span
              key={d}
              style={{ ...abs, border: `1.5px solid ${GOLD}`, animation: `nav-orb-pulse ${mood === "speaking" ? "1.1s" : "2.2s"} ease-out ${d}s infinite` }}
            />
          ))
        : null}
      {/* turning halo */}
      <span
        style={{
          ...abs,
          inset: small ? -1.5 : -4,
          background: `conic-gradient(from 0deg, transparent 0deg, ${GOLD} 40deg, rgba(212,163,84,.15) 120deg, transparent 180deg, rgba(185,162,232,.55) 250deg, transparent 320deg)`,
          filter: small ? "blur(.5px)" : "blur(3px)",
          animation: `nav-orb-spin ${spin} linear infinite`,
          opacity: busy || voice ? 1 : 0.75,
        }}
      />
      {/* glass sphere */}
      <span
        style={{
          ...abs,
          overflow: "hidden",
          background: "radial-gradient(circle at 50% 62%, #1c1e23 0%, #0d0e11 62%, #070809 100%)",
          boxShadow: `inset 0 0 ${small ? 4 : 18}px rgba(0,0,0,.9), inset 0 0 0 1px rgba(212,163,84,.55), 0 ${small ? 1 : 10}px ${small ? 4 : 30}px rgba(0,0,0,.55)`,
        }}
      >
        {/* drifting light inside */}
        {!small ? (
          <>
            <span style={{ position: "absolute", left: "8%", top: "12%", width: "62%", height: "62%", borderRadius: "50%", background: "radial-gradient(circle, rgba(212,163,84,.55), transparent 65%)", filter: "blur(10px)", animation: "nav-orb-drift-a 9s ease-in-out infinite" }} />
            <span style={{ position: "absolute", right: "4%", bottom: "6%", width: "58%", height: "58%", borderRadius: "50%", background: "radial-gradient(circle, rgba(185,162,232,.42), transparent 65%)", filter: "blur(12px)", animation: "nav-orb-drift-b 12s ease-in-out infinite" }} />
          </>
        ) : null}
        {/* the mark */}
        <span style={{ ...abs, display: "flex", alignItems: "center", justifyContent: "center", animation: `nav-orb-breathe ${busy ? "1.6s" : "4.5s"} ease-in-out infinite` }}>
          <NavMark
            size={Math.round(size * 0.5)}
            style={{ color: "#F3F2EC", filter: small ? "none" : `drop-shadow(0 0 ${busy ? 10 : 6}px rgba(212,163,84,.65))` }}
          />
        </span>
        {/* specular highlight */}
        <span style={{ ...abs, background: "radial-gradient(circle at 30% 22%, rgba(255,255,255,.28), rgba(255,255,255,0) 32%)" }} />
      </span>
      {/* orbiting points */}
      {!small
        ? [
            { r: 0.62, t: busy ? 2.6 : 7, tilt: 68, c: GOLD, s: 5 },
            { r: 0.56, t: busy ? 3.4 : 10, tilt: -60, c: "#F3F2EC", s: 3.5 },
            { r: 0.66, t: busy ? 4.2 : 14, tilt: 15, c: "#B9A2E8", s: 4 },
          ].map((o, i) => (
            <span key={i} style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0, transform: `rotate(${o.tilt}deg) scaleY(.32)` }}>
              <span style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, animation: `nav-orb-spin ${o.t}s linear infinite` }}>
                <span
                  style={{
                    position: "absolute",
                    left: size * o.r - o.s / 2,
                    top: -o.s / 2,
                    width: o.s,
                    height: o.s,
                    borderRadius: "50%",
                    background: o.c,
                    boxShadow: `0 0 8px ${o.c}`,
                  }}
                />
              </span>
            </span>
          ))
        : null}
    </Tag>
  );
}

const TINT: Record<string, string> = { claude: "#E8975A", codex: "#F3F2EC", cursor: "#B9A2E8" };

/** One subscription as an orb: fill = cycle use, ring = session use. */
export function HarnessOrb({
  harness,
  cycle,
  session,
  working,
  size = 112,
  icon,
}: {
  harness: "claude" | "codex" | "cursor";
  cycle: number | null;
  session: number | null;
  working: boolean;
  size?: number;
  icon: ReactNode;
}) {
  inject();
  const tint = TINT[harness];
  const fill = Math.max(0, Math.min(100, cycle ?? 0));
  const ring = Math.max(0, Math.min(100, session ?? 0));
  const R = 47;
  const C = 2 * Math.PI * R;
  const hot = fill >= 85 ? "#E8796A" : tint;
  return (
    <div className="nav-orb" style={{ position: "relative", width: size, height: size, flex: "none" }}>
      {working ? <span style={{ ...abs, inset: -6, background: `radial-gradient(circle, ${tint}55, transparent 68%)`, animation: "nav-orb-glow 1.6s ease-in-out infinite" }} /> : null}
      <span
        style={{
          ...abs,
          overflow: "hidden",
          background: "radial-gradient(circle at 50% 60%, #1a1c20, #0a0b0d 72%)",
          boxShadow: `inset 0 0 16px rgba(0,0,0,.9), inset 0 0 0 1px ${tint}55`,
        }}
      >
        {/* liquid */}
        <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${fill}%`, transition: "height 900ms cubic-bezier(.2,.8,.2,1)" }}>
          <svg viewBox="0 0 200 20" preserveAspectRatio="none" style={{ position: "absolute", top: -9, left: 0, width: "200%", height: 12, animation: `nav-orb-wave ${working ? "1.8s" : "5s"} linear infinite` }}>
            <path d="M0 10 Q25 0 50 10 T100 10 T150 10 T200 10 V20 H0 Z" fill={hot} fillOpacity=".55" />
          </svg>
          <span style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, ${hot}8c, ${hot}33)` }} />
        </span>
        <span style={{ ...abs, display: "flex", alignItems: "center", justifyContent: "center", color: "#F3F2EC" }}>{icon}</span>
        <span style={{ ...abs, background: "radial-gradient(circle at 30% 22%, rgba(255,255,255,.22), rgba(255,255,255,0) 34%)" }} />
      </span>
      {/* session ring */}
      <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: -5, width: size + 10, height: size + 10, transform: "rotate(-90deg)" }}>
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="2" />
        {session !== null ? (
          <circle cx="50" cy="50" r={R} fill="none" stroke={GOLD} strokeWidth="2" strokeLinecap="round" strokeDasharray={`${(ring / 100) * C} ${C}`} style={{ transition: "stroke-dasharray 900ms ease" }} />
        ) : null}
      </svg>
    </div>
  );
}
