"use client";

import { useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import rowsRaw from "../data/paces.json";

type InputDistance = "800" | "mile" | "2mile" | "5k" | "10k" | "half" | "marathon";
type InputMode = "time" | "pi";

type PaceRow = {
  id: number;
  paceIndex: number;
  label: string;

  pred: {
    m800: number;
    mile: number;
    twoMile: number;
    k5: number;
    half: number;
    marathon: number;
  };

  // race paces (per mile) from chart
  pace: {
    mile: number;
    twoMile: number;
    k5: number;
  };

  thresholdPace?: number;

  fivekRepeats?: {
    m1600: number;
    m1200: number;
    m1000: number;
    m800: number;
    m400: number;
    m100: number;
  };

  cv: {
    m100: number | null;
    m400: number;
    m800: number;
    m1000: number;
    m1200: number;
    m1600: number;
  };

  speed2m: {
    m600: number;
    m400: number;
    m300: number;
    m200: number;
    m100: number;
  };
};

const rows: PaceRow[] = (rowsRaw as any[])
  .map((r) => r as PaceRow)
  .sort((a, b) => a.paceIndex - b.paceIndex);

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

function formatPaceSeconds(secPerMile: number): string {
  const s = Math.max(0, Math.round(secPerMile));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

function formatRaceTimeSeconds(totalSeconds: number): string {
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

function pacePerMileFromRaceSeconds(raceSeconds: number, meters: number): number {
  const miles = meters / 1609.344;
  return raceSeconds / miles;
}

// Riegel projection for 10K from 5K prediction (since chart doesn't include 10K)
function predict10kFrom5kSeconds(pred5kSec: number): number {
  return pred5kSec * Math.pow(2, 1.06);
}

function getPredictionSeconds(r: PaceRow, d: InputDistance): number {
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

function findClosestRowByTime(rows: PaceRow[], d: InputDistance, inputSeconds: number): PaceRow {
  let best = rows[0];
  let bestDiff = Math.abs(getPredictionSeconds(best, d) - inputSeconds);

  for (const r of rows) {
    const t = getPredictionSeconds(r, d);
    const diff = Math.abs(t - inputSeconds);
    if (diff < bestDiff) {
      best = r;
      bestDiff = diff;
    }
  }
  return best;
}

function findRowByPI(rows: PaceRow[], pi: number): PaceRow {
  // Exact match preferred
  const exact = rows.find((r) => r.paceIndex === pi);
  if (exact) return exact;

  // Otherwise nearest PI
  let best = rows[0];
  let bestDiff = Math.abs(rows[0].paceIndex - pi);
  for (const r of rows) {
    const diff = Math.abs(r.paceIndex - pi);
    if (diff < bestDiff) {
      best = r;
      bestDiff = diff;
    }
  }
  return best;
}

// ----- Your philosophy rules -----
function recoveryPaceFrom5kPace(k5Pace: number) {
  return k5Pace + 110; // +1:50
}
function steadyRangeFrom5kPace(k5Pace: number) {
  return { low: k5Pace + 60, high: k5Pace + 75 };
}
function powerRunPaceFrom2milePace(twoMilePace: number) {
  return twoMilePace + 30;
}
function splitFromMilePace(secPerMile: number, meters: number) {
  return (secPerMile / 1609.344) * meters;
}

function PaceCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid #cfcfcf",
        borderRadius: 14,
        padding: 12,
        background: "white",
      }}
    >
      <div style={{ fontWeight: 900, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

export default function Page() {
  const [mode, setMode] = useState<"OTR" | "UPREP">("OTR");
  const [inputMode, setInputMode] = useState<InputMode>("time");

  const [distance, setDistance] = useState<InputDistance>("5k");
  const [timeStr, setTimeStr] = useState("");
  const [piStr, setPiStr] = useState("61");

  const resultsRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => {
    if (inputMode === "pi") {
      const pi = Number(piStr);
      if (!Number.isFinite(pi)) return null;
      return findRowByPI(rows, pi);
    }

    const sec = parseTimeToSeconds(timeStr);
    if (sec == null) return null;
    return findClosestRowByTime(rows, distance, sec);
  }, [inputMode, piStr, distance, timeStr]);

  const content = useMemo(() => {
    if (!selected) return null;

    // Rule-based training paces from 5k pace
    const rec = recoveryPaceFrom5kPace(selected.pace.k5);
    const steady = steadyRangeFrom5kPace(selected.pace.k5);

    // Power run rule
    const power = powerRunPaceFrom2milePace(selected.pace.twoMile);

    // Threshold pace from chart (fallback to mile race pace if missing)
    const thrPace = selected.thresholdPace ?? selected.pace.mile;
    const thr400 = splitFromMilePace(thrPace, 400);
    const thr100 = splitFromMilePace(thrPace, 100);

    // Race predictions (time + derived pace per mile)
    const pred10k = predict10kFrom5kSeconds(selected.pred.k5);
    const racePredItems = [
      { label: "800", meters: 800, timeSec: selected.pred.m800 },
      { label: "Mile", meters: 1609.344, timeSec: selected.pred.mile },
      { label: "2 Mile", meters: 3218.688, timeSec: selected.pred.twoMile },
      { label: "5K", meters: 5000, timeSec: selected.pred.k5 },
      { label: "10K", meters: 10000, timeSec: pred10k },
      { label: "Half", meters: 21097.5, timeSec: selected.pred.half },
      { label: "Marathon", meters: 42195, timeSec: selected.pred.marathon },
    ];

    // 5k repeats from chart (fallback to computed if missing)
    const fivekRows =
      selected.fivekRepeats
        ? [
            { meters: 100, seconds: selected.fivekRepeats.m100 },
            { meters: 400, seconds: selected.fivekRepeats.m400 },
            { meters: 800, seconds: selected.fivekRepeats.m800 },
            { meters: 1000, seconds: selected.fivekRepeats.m1000 },
            { meters: 1200, seconds: selected.fivekRepeats.m1200 },
            { meters: 1600, seconds: selected.fivekRepeats.m1600 },
          ]
        : [100, 400, 800, 1000, 1200, 1600].map((m) => ({
            meters: m,
            seconds: splitFromMilePace(selected.pace.k5, m),
          }));

    // CV rows (rep times)
    const cvRows = [
      { label: "100", seconds: selected.cv.m100 ?? Math.round(selected.cv.m400 / 4) },
      { label: "400", seconds: selected.cv.m400 },
      { label: "800", seconds: selected.cv.m800 },
      { label: "1000", seconds: selected.cv.m1000 },
      { label: "1200", seconds: selected.cv.m1200 },
      { label: "1600", seconds: selected.cv.m1600 },
    ];

    // 2mi repeats rows
    const speedRows = [
      { label: "100", seconds: selected.speed2m.m100 },
      { label: "200", seconds: selected.speed2m.m200 },
      { label: "300", seconds: selected.speed2m.m300 },
      { label: "400", seconds: selected.speed2m.m400 },
      { label: "600", seconds: selected.speed2m.m600 },
    ];

    return (
      <>
        <div className="twoCol">
          {/* LEFT COLUMN */}
          <div style={{ display: "grid", gap: 10 }}>
            <PaceCard title="Race Predictions">
              <div style={{ display: "grid", gap: 6 }}>
                {racePredItems.map((it) => {
                  const pace = pacePerMileFromRaceSeconds(it.timeSec, it.meters);
                  return (
                    <div key={it.label}>
                      {it.label}: <b>{formatRaceTimeSeconds(it.timeSec)}</b> ({formatPaceSeconds(pace)}/mi)
                    </div>
                  );
                })}
              </div>
            </PaceCard>

            <PaceCard title="Training Paces">
              <div style={{ display: "grid", gap: 6 }}>
                <div>
                  Recovery: <b>{formatPaceSeconds(rec)}</b>/mi
                </div>
                <div>
                  Steady: <b>{formatPaceSeconds(steady.low)}–{formatPaceSeconds(steady.high)}</b>/mi
                </div>
              </div>
            </PaceCard>

            <PaceCard title="Threshold">
              <div style={{ display: "grid", gap: 6 }}>
                <div>
                  Pace: <b>{formatPaceSeconds(thrPace)}</b>/mi
                </div>
                <div>
                  400: <b>{formatRaceTimeSeconds(thr400)}</b>
                </div>
                <div>
                  100: <b>{formatRaceTimeSeconds(thr100)}</b>
                </div>
              </div>
            </PaceCard>

            <PaceCard title="Power Run">
              <div style={{ display: "grid", gap: 6 }}>
                <div>
                  Pace: <b>{formatPaceSeconds(power)}</b>/mi
                </div>
                <div style={{ fontSize: 12, color: "#555" }}>(2 mile race pace + :30)</div>
              </div>
            </PaceCard>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: "grid", gap: 10 }}>
            <PaceCard title="Critical Velocity Repeats">
              <div style={{ display: "grid", gap: 6 }}>
                {cvRows.map((r) => (
                  <div key={r.label}>
                    {r.label}: <b>{formatRaceTimeSeconds(r.seconds)}</b>
                  </div>
                ))}
              </div>
            </PaceCard>

            <PaceCard title="5k Pace Repeats">
              <div style={{ display: "grid", gap: 6 }}>
                {fivekRows.map((r) => (
                  <div key={r.meters}>
                    {r.meters}m: <b>{formatRaceTimeSeconds(r.seconds)}</b>
                  </div>
                ))}
              </div>
            </PaceCard>
<PaceCard title="2mi Repeats">
            <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
              {speedRows.map((r) => (
                <div key={r.label}>
                  {r.label}: <b>{formatRaceTimeSeconds(r.seconds)}</b>
                </div>
              ))}
            </div>
          </PaceCard>
          </div>
        </div>

  
          
      

        <style jsx>{`
          .twoCol {
            display: grid;
            gap: 10px;
            grid-template-columns: 1fr;
            align-items: start;
          }
          @media (min-width: 860px) {
            .twoCol {
              grid-template-columns: 1fr 1fr;
            }
          }
        `}</style>
      </>
    );
  }, [selected]);

  const canSave = !!selected;

  return (
    <div style={{ minHeight: "100vh", padding: 16 }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, margin: 0 }}>{mode === "OTR" ? "On The Run Pace Index" : "UPrep Pace Index"}</h1>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setMode("OTR")}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #ccc",
                background: mode === "OTR" ? "#111" : "white",
                color: mode === "OTR" ? "white" : "#111",
              }}
            >
              OTR
            </button>
            <button
              onClick={() => setMode("UPREP")}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #ccc",
                background: mode === "UPREP" ? "#111" : "white",
                color: mode === "UPREP" ? "white" : "#111",
              }}
            >
              UPREP
            </button>
          </div>
        </div>

        <section style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Input Type</span>
              <select value={inputMode} onChange={(e) => setInputMode(e.target.value as InputMode)} style={{ minWidth: 220 }}>
                <option value="time">From Race Time</option>
                <option value="pi">From Pace Index</option>
              </select>
            </label>

            {inputMode === "time" ? (
              <>
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
                  <input value={timeStr} onChange={(e) => setTimeStr(e.target.value)} placeholder="e.g., 16:45" inputMode="numeric" style={{ minWidth: 220 }} />
                </label>
              </>
            ) : (
              <label style={{ display: "grid", gap: 6 }}>
                <span>Pace Index</span>
                <input value={piStr} onChange={(e) => setPiStr(e.target.value)} placeholder="e.g., 61" inputMode="numeric" style={{ minWidth: 220 }} />
              </label>
            )}

            <button
              onClick={async () => {
                if (!selected || !resultsRef.current) return;

                const node = resultsRef.current;

                // iPhone-ish capture width
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
              disabled={!canSave}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #ccc",
                background: canSave ? "#111" : "#eee",
                color: canSave ? "white" : "#777",
              }}
            >
              Save as Image
            </button>
          </div>
        </section>

        <div
          ref={resultsRef}
          style={{
            marginTop: 12,
            borderRadius: 14,
            padding: 12,
            background: "white",
            border: "1px solid #cfcfcf",
          }}
        >
          {selected ? (
            <>
              <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 6 }}>
                {mode} • Pace Index {selected.paceIndex}
              </div>
              <div style={{ color: "#333", marginBottom: 10 }}>
                {inputMode === "time"
                  ? `Input: ${distance.toUpperCase()} ${timeStr}`
                  : `Input: Pace Index ${selected.paceIndex}`}
              </div>
              {content}
            </>
          ) : (
            <div style={{ color: "#666" }}>
              {inputMode === "time" ? "Enter a distance and time to see your paces." : "Enter a Pace Index (30–73)."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
