"use client";

import { useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import rowsRaw from "../data/paces.json";

type InputDistance = "800" | "mile" | "2mile" | "5k" | "10k" | "half" | "marathon";

type PaceRow = {
  id: number;
  paceIndex: number;
  label: string;
  pred: { m800: number; mile: number; twoMile: number; k5: number; half: number; marathon: number };
  pace: { mile: number; twoMile: number; k5: number };
  cv: { m100: number; m400: number; m800: number; m1000: number; m1200: number };
  speed2m: { m100: number; m200: number; m300: number; m400: number; m600: number };
};

const rows: PaceRow[] = (rowsRaw as any[]).map((r) => r as PaceRow).sort((a, b) => a.paceIndex - b.paceIndex);

function parseTimeToSeconds(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const parts = t.split(":").map((x) => x.trim());
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n))) return null;
  if (nums.length === 2) return Math.round(nums[0] * 60 + nums[1]);
  if (nums.length === 3) return Math.round(nums[0] * 3600 + nums[1] * 60 + nums[2]);
  return null;
}

function formatPace(secPerMile: number): string {
  const s = Math.max(0, Math.round(secPerMile));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

function formatRaceTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const rem = s % 3600;
    const m = Math.floor(rem / 60);
    const ss = rem % 60;
    return `${h}:${m.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
  }
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function predict10kFrom5kSeconds(pred5kSec: number): number {
  return pred5kSec * Math.pow(2, 1.06);
}

function pacePerMileFromRaceSeconds(raceSeconds: number, meters: number): number {
  const miles = meters / 1609.344;
  return raceSeconds / miles;
}

function getPredSeconds(r: PaceRow, d: InputDistance): number {
  switch (d) {
    case "800":
      return r.pred.m800;
    case "mile":
      return r.pred.mile;
    case "2mile":
      return r.pred.twoMile;
    case "5k":
      return r.pred.k5;
    case "10k":
      return predict10kFrom5kSeconds(r.pred.k5);
    case "half":
      return r.pred.half;
    case "marathon":
      return r.pred.marathon;
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function blendRow(a: PaceRow, b: PaceRow, t: number): PaceRow {
  const pi = Math.round(lerp(a.paceIndex, b.paceIndex, t));
  return {
    id: -1,
    paceIndex: pi,
    label: `PI ${pi}`,
    pred: {
      m800: Math.round(lerp(a.pred.m800, b.pred.m800, t)),
      mile: Math.round(lerp(a.pred.mile, b.pred.mile, t)),
      twoMile: Math.round(lerp(a.pred.twoMile, b.pred.twoMile, t)),
      k5: Math.round(lerp(a.pred.k5, b.pred.k5, t)),
      half: Math.round(lerp(a.pred.half, b.pred.half, t)),
      marathon: Math.round(lerp(a.pred.marathon, b.pred.marathon, t)),
    },
    pace: {
      mile: Math.round(lerp(a.pace.mile, b.pace.mile, t)),
      twoMile: Math.round(lerp(a.pace.twoMile, b.pace.twoMile, t)),
      k5: Math.round(lerp(a.pace.k5, b.pace.k5, t)),
    },
    cv: {
      m100: Math.round(lerp(a.cv.m100, b.cv.m100, t)),
      m400: Math.round(lerp(a.cv.m400, b.cv.m400, t)),
      m800: Math.round(lerp(a.cv.m800, b.cv.m800, t)),
      m1000: Math.round(lerp(a.cv.m1000, b.cv.m1000, t)),
      m1200: Math.round(lerp(a.cv.m1200, b.cv.m1200, t)),
    },
    speed2m: {
      m100: Math.round(lerp(a.speed2m.m100, b.speed2m.m100, t)),
      m200: Math.round(lerp(a.speed2m.m200, b.speed2m.m200, t)),
      m300: Math.round(lerp(a.speed2m.m300, b.speed2m.m300, t)),
      m400: Math.round(lerp(a.speed2m.m400, b.speed2m.m400, t)),
      m600: Math.round(lerp(a.speed2m.m600, b.speed2m.m600, t)),
    },
  };
}

// Interpolate/extrapolate between rows based on prediction time for the chosen input distance
function pickInterpolatedRow(d: InputDistance, inputSeconds: number): PaceRow {
  const list = rows
    .map((r) => ({ r, t: getPredSeconds(r, d) }))
    .filter((x) => Number.isFinite(x.t))
    .sort((x, y) => x.t - y.t);

  // If input is faster than fastest, extrapolate using first two
  if (inputSeconds <= list[0].t) {
    const a = list[0];
    const b = list[1];
    const t = (inputSeconds - a.t) / (b.t - a.t); // negative
    return blendRow(a.r, b.r, t);
  }

  // If input is slower than slowest, extrapolate using last two
  if (inputSeconds >= list[list.length - 1].t) {
    const a = list[list.length - 2];
    const b = list[list.length - 1];
    const t = (inputSeconds - a.t) / (b.t - a.t); // >1
    return blendRow(a.r, b.r, t);
  }

  // Otherwise interpolate between bracket
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i];
    const b = list[i + 1];
    if (inputSeconds >= a.t && inputSeconds <= b.t) {
      const t = (inputSeconds - a.t) / (b.t - a.t);
      return blendRow(a.r, b.r, t);
    }
  }

  return list[0].r;
}

// Your philosophy
function recoveryPace(k5Pace: number) {
  return k5Pace + 110;
}
function steadyRange(k5Pace: number) {
  return { low: k5Pace + 60, high: k5Pace + 75 };
}
function thresholdSplits(milePace: number) {
  return { mile: milePace, m400: milePace / 4, m100: milePace / 16 };
}
function powerRunPace(twoMilePace: number) {
  return twoMilePace + 30;
}
function splitFromMilePace(secPerMile: number, meters: number) {
  return (secPerMile / 1609.344) * meters;
}

function PaceCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #cfcfcf", borderRadius: 14, padding: 12, background: "white" }}>
      <div style={{ fontWeight: 900, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

export default function Page() {
  const [mode, setMode] = useState<"OTR" | "UPREP">("OTR");
  const [distance, setDistance] = useState<InputDistance>("5k");
  const [timeStr, setTimeStr] = useState("");
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => {
    const sec = parseTimeToSeconds(timeStr);
    if (sec == null) return null;
    return pickInterpolatedRow(distance, sec);
  }, [distance, timeStr]);

  const content = useMemo(() => {
    if (!selected) return null;

    const rec = recoveryPace(selected.pace.k5);
    const steady = steadyRange(selected.pace.k5);
    const thr = thresholdSplits(selected.pace.mile);
    const power = powerRunPace(selected.pace.twoMile);

    const fivekRepeatMeters = [100, 400, 800, 1000, 1200, 1600];

    const raceItems = [
      { label: "800", meters: 800, timeSec: selected.pred.m800 },
      { label: "Mile", meters: 1609.344, timeSec: selected.pred.mile },
      { label: "2 Mile", meters: 3218.688, timeSec: selected.pred.twoMile },
      { label: "5K", meters: 5000, timeSec: selected.pred.k5 },
      { label: "10K", meters: 10000, timeSec: predict10kFrom5kSeconds(selected.pred.k5) },
      { label: "Half", meters: 21097.5, timeSec: selected.pred.half },
      { label: "Marathon", meters: 42195, timeSec: selected.pred.marathon },
    ];

    return (
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          alignItems: "start",
        }}
      >
        {/* Race Predictions | Training Paces */}
        <PaceCard title="Race Predictions">
          <div style={{ display: "grid", gap: 6 }}>
            {raceItems.map((it) => {
              const pace = pacePerMileFromRaceSeconds(it.timeSec, it.meters);
              return (
                <div key={it.label}>
                  {it.label}: <b>{formatRaceTime(it.timeSec)}</b> ({formatPace(pace)}/mi)
                </div>
              );
            })}
          </div>
        </PaceCard>

        <PaceCard title="Training Paces">
          <div style={{ display: "grid", gap: 6 }}>
            <div>Recovery: <b>{formatPace(rec)}</b>/mi</div>
            <div>Steady: <b>{formatPace(steady.low)}–{formatPace(steady.high)}</b>/mi</div>
          </div>
        </PaceCard>

        {/* Power Run | Threshold */}
        <PaceCard title="Power Run">
          <div style={{ display: "grid", gap: 6 }}>
            <div>Pace: <b>{formatPace(power)}</b>/mi</div>
          </div>
        </PaceCard>

        <PaceCard title="Threshold">
          <div style={{ display: "grid", gap: 6 }}>
            <div>Mile pace: <b>{formatPace(thr.mile)}</b>/mi</div>
            <div>400: <b>{formatRaceTime(thr.m400)}</b></div>
            <div>100: <b>{formatRaceTime(thr.m100)}</b></div>
          </div>
        </PaceCard>

        {/* CV | 5k repeats */}
        <PaceCard title="Critical Velocity Repeats">
          <div style={{ display: "grid", gap: 6 }}>
            <div>100: <b>{formatRaceTime(selected.cv.m100)}</b></div>
            <div>400: <b>{formatRaceTime(selected.cv.m400)}</b></div>
            <div>800: <b>{formatRaceTime(selected.cv.m800)}</b></div>
            <div>1000: <b>{formatRaceTime(selected.cv.m1000)}</b></div>
            <div>1200: <b>{formatRaceTime(selected.cv.m1200)}</b></div>
            <div>1600: <b>{formatRaceTime(selected.cv.m1200 * (1600 / 1200))}</b></div>
          </div>
        </PaceCard>

        <PaceCard title="5k Pace Repeats">
          <div style={{ display: "grid", gap: 6 }}>
            {fivekRepeatMeters.map((m) => (
              <div key={m}>
                {m}m: <b>{formatRaceTime(splitFromMilePace(selected.pace.k5, m))}</b>
              </div>
            ))}
          </div>
        </PaceCard>

        {/* 2 mile repeats full width */}
        <div style={{ gridColumn: "1 / -1" }}>
          <PaceCard title="2mi Repeats">
            <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
              <div>100: <b>{formatRaceTime(selected.speed2m.m100)}</b></div>
              <div>200: <b>{formatRaceTime(selected.speed2m.m200)}</b></div>
              <div>300: <b>{formatRaceTime(selected.speed2m.m300)}</b></div>
              <div>400: <b>{formatRaceTime(selected.speed2m.m400)}</b></div>
            </div>
          </PaceCard>
        </div>
      </div>
    );
  }, [selected]);

  return (
    <div style={{ minHeight: "100vh", padding: 16 }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, margin: 0 }}>{mode === "OTR" ? "On The Run Pace Index" : "UPrep Pace Index"}</h1>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setMode("OTR")} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ccc", background: mode === "OTR" ? "#111" : "white", color: mode === "OTR" ? "white" : "#111" }}>
              OTR
            </button>
            <button onClick={() => setMode("UPREP")} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ccc", background: mode === "UPREP" ? "#111" : "white", color: mode === "UPREP" ? "white" : "#111" }}>
              UPREP
            </button>
          </div>
        </div>

        <section style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Input Distance</span>
              <select value={distance} onChange={(e) => setDistance(e.target.value as InputDistance)} style={{ minWidth: 220 }}>
                <option value="800">800</option>
                <option value="mile">Mile</option>
                <option value="2mile">2 Mile</option>
                <option value="5k">5K</option>
                <option value="10k">10K</option>
                <option value="half">Half Marathon</option>
                <option value="marathon">Marathon</option>
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span>Time (mm:ss or h:mm:ss)</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input value={timeStr} onChange={(e) => setTimeStr(e.target.value)} placeholder="e.g., 16:45" inputMode="numeric" style={{ minWidth: 220 }} />

                <button
                  onClick={async () => {
                    if (!selected) return;
                    const lines = [`${mode} • Pace Index ${selected.paceIndex}`, `Input: ${distance.toUpperCase()} ${timeStr}`];
                    await navigator.clipboard.writeText(lines.join("\n"));
                    alert("Copied header (pace card is best saved as image).");
                  }}
                  disabled={!selected}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", background: selected ? "#111" : "#eee", color: selected ? "white" : "#777" }}
                >
                  Copy
                </button>

                <button
                  onClick={async () => {
                    if (!selected || !resultsRef.current) return;
                    const node = resultsRef.current;

                    const prevWidth = node.style.width;
                    const prevMaxWidth = node.style.maxWidth;
                    node.style.width = "390px";
                    node.style.maxWidth = "390px";

                    const dataUrl = await toPng(node, { cacheBust: true, pixelRatio: 2, backgroundColor: "#ffffff" });

                    node.style.width = prevWidth;
                    node.style.maxWidth = prevMaxWidth;

                    const link = document.createElement("a");
                    link.download = `${mode}-PaceIndex-${selected.paceIndex}.png`;
                    link.href = dataUrl;
                    link.click();
                  }}
                  disabled={!selected}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", background: selected ? "white" : "#eee", color: selected ? "#111" : "#777" }}
                >
                  Save as Image
                </button>
              </div>
            </label>
          </div>
        </section>

        <div ref={resultsRef} style={{ marginTop: 12, borderRadius: 14, padding: 12, background: "white", border: "1px solid #cfcfcf" }}>
          {selected ? (
            <>
              <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 6 }}>
                {mode} • Pace Index {selected.paceIndex}
              </div>
              <div style={{ color: "#333", marginBottom: 10 }}>
                Input: {distance.toUpperCase()} {timeStr}
              </div>
              {content}
            </>
          ) : (
            <div style={{ color: "#666" }}>Enter a distance and time to see your paces.</div>
          )}
        </div>
      </div>
    </div>
  );
}
