"use client";

import { useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import paces from "../data/paces.json";

type InputDistance = "800" | "mile" | "2mile" | "5k" | "10k" | "half" | "marathon";

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

  pace: { mile: number; twoMile: number; k5: number };
  cv: { m100: number; m400: number; m800: number; m1000: number; m1200: number };
  speed2m: { m100: number; m200: number; m300: number; m400: number; m600: number };
};

function parseTimeToSeconds(input: string): number | null {
  const s = (input || "").trim();
  if (!s) return null;
  const parts = s.split(":").map((p) => p.trim());
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n))) return null;
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  return null;
}

function formatSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "—";
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function predict10kFrom5kSeconds(pred5kSec: number): number {
  // Riegel projection: T2 = T1 * (D2/D1)^1.06
  // 10k / 5k = 2
  return pred5kSec * Math.pow(2, 1.06);
}

function getPredictionSeconds(row: PaceRow, d: InputDistance): number {
  switch (d) {
    case "800":
      return row.pred.m800;
    case "mile":
      return row.pred.mile;
    case "2mile":
      return row.pred.twoMile;
    case "5k":
      return row.pred.k5;
    case "10k":
      return predict10kFrom5kSeconds(row.pred.k5);
    case "half":
      return row.pred.half;
    case "marathon":
      return row.pred.marathon;
  }
}

function findClosestRow(rows: PaceRow[], d: InputDistance, inputSeconds: number): PaceRow {
  let best = rows[0];
  let bestDiff = Math.abs(getPredictionSeconds(best, d) - inputSeconds);
  for (const r of rows) {
    const t = getPredictionSeconds(r, d);
    if (!Number.isFinite(t)) continue;
    const diff = Math.abs(t - inputSeconds);
    if (diff < bestDiff) {
      best = r;
      bestDiff = diff;
    }
  }
  return best;
}

// Your philosophy rules
function recoveryPace(pace5k: number) {
  return pace5k + 110; // 5k + 1:50
}
function steadyRange(pace5k: number) {
  return { low: pace5k + 60, high: pace5k + 75 };
}
function thresholdSplits(milePace: number) {
  return { mile: milePace, m400: milePace / 4, m100: milePace / 16 };
}
function powerRunPace(twoMilePace: number) {
  return twoMilePace + 30;
}

const METERS_PER_MILE = 1609.344;
function splitFromMilePace(pacePerMileSec: number, meters: number) {
  return pacePerMileSec * (meters / METERS_PER_MILE);
}

function PaceCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12, background: "white" }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function PaceTable({ rows }: { rows: { meters: number; seconds: number }[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Distance</th>
          <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>Time</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.meters}>
            <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{r.meters}m</td>
            <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
              {formatSeconds(r.seconds)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function buildCopyText(args: { mode: "OTR" | "UPREP"; selected: PaceRow }): string {
  const { mode, selected } = args;

  const rec = recoveryPace(selected.pace.k5);
  const steady = steadyRange(selected.pace.k5);
  const thr = thresholdSplits(selected.pace.mile);
  const power = powerRunPace(selected.pace.twoMile);

  const cv = [
    `100 ${formatSeconds(selected.cv.m100)}`,
    `400 ${formatSeconds(selected.cv.m400)}`,
    `800 ${formatSeconds(selected.cv.m800)}`,
    `1000 ${formatSeconds(selected.cv.m1000)}`,
    `1200 ${formatSeconds(selected.cv.m1200)}`,
    `1600 ${formatSeconds(selected.cv.m1200 * (1600 / 1200))}`, // simple derive if 1600 not stored
  ].join(" | ");

  const fivekRepeatMeters = [100, 400, 800, 1000, 1200, 1600];
  const fivekRepeats = fivekRepeatMeters
    .map((m) => `${m} ${formatSeconds(splitFromMilePace(selected.pace.k5, m))}`)
    .join(" | ");

  const twoMiRepeats = [
    `100 ${formatSeconds(selected.speed2m.m100)}`,
    `200 ${formatSeconds(selected.speed2m.m200)}`,
    `300 ${formatSeconds(selected.speed2m.m300)}`,
    `400 ${formatSeconds(selected.speed2m.m400)}`,
  ].join(" | ");

  return [
    `${mode} • Pace Index ${selected.paceIndex}`,
    `Recovery: ${formatSeconds(rec)}/mi`,
    `Steady: ${formatSeconds(steady.low)}–${formatSeconds(steady.high)}/mi`,
    `Threshold (mile pace): ${formatSeconds(thr.mile)}/mi | 400 ${formatSeconds(thr.m400)} | 100 ${formatSeconds(thr.m100)}`,
    `Critical Velocity: ${cv}`,
    `Power Run: ${formatSeconds(power)}/mi`,
    `5k Repeats: ${fivekRepeats}`,
    `2mi Repeats: ${twoMiRepeats}`,
  ].join("\n");
}



export default function Page() {
  const rows = paces as unknown as PaceRow[];

const [mode, setMode] = useState<"OTR" | "UPREP">("OTR");


  const [distance, setDistance] = useState<InputDistance>("5k");
  const [timeStr, setTimeStr] = useState("");
  const resultsRef = useRef<HTMLDivElement | null>(null);


  const selected = useMemo(() => {
    const sec = parseTimeToSeconds(timeStr);
    if (sec == null) return null;
    return findClosestRow(rows, distance, sec);
  }, [rows, distance, timeStr]);

  const content = useMemo(() => {
    if (!selected) return null;

    const rec = recoveryPace(selected.pace.k5);
    const steady = steadyRange(selected.pace.k5);
    const thr = thresholdSplits(selected.pace.mile);
    const power = powerRunPace(selected.pace.twoMile);

    const cvRows = [
      { meters: 100, seconds: selected.cv.m100 },
      { meters: 400, seconds: selected.cv.m400 },
      { meters: 800, seconds: selected.cv.m800 },
      { meters: 1000, seconds: selected.cv.m1000 },
      { meters: 1200, seconds: selected.cv.m1200 },
    ];

    const speedRows = [
      { meters: 100, seconds: selected.speed2m.m100 },
      { meters: 200, seconds: selected.speed2m.m200 },
      { meters: 300, seconds: selected.speed2m.m300 },
      { meters: 400, seconds: selected.speed2m.m400 },
      { meters: 600, seconds: selected.speed2m.m600 },
    ];

    const fivekRepeatMeters = [100, 400, 800, 1000, 1200, 1600];
    const fivekRows = fivekRepeatMeters.map((m) => ({
      meters: m,
      seconds: splitFromMilePace(selected.pace.k5, m),
    }));

   return (
  <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
    <PaceCard title="Predicted Race Times">
      <div style={{ display: "grid", gap: 6 }}>
        <div>800: <b>{formatSeconds(selected.pred.m800)}</b></div>
        <div>Mile: <b>{formatSeconds(selected.pred.mile)}</b></div>
        <div>2 Mile: <b>{formatSeconds(selected.pred.twoMile)}</b></div>
        <div>5K: <b>{formatSeconds(selected.pred.k5)}</b></div>
        <div>10K: <b>{formatSeconds(predict10kFrom5kSeconds(selected.pred.k5))}</b></div>
        <div>Half: <b>{formatSeconds(selected.pred.half)}</b></div>
        <div>Marathon: <b>{formatSeconds(selected.pred.marathon)}</b></div>
      </div>
    </PaceCard>

    {/* your existing cards continue here */}
    <PaceCard title="Race Paces">
      ...
    </PaceCard>



        
<PaceCard title="Race Paces">
          <div style={{ display: "grid", gap: 6 }}>
            <div>1 Mile pace: <b>{formatSeconds(selected.pace.mile)}</b> /mi</div>
            <div>2 Mile pace: <b>{formatSeconds(selected.pace.twoMile)}</b> /mi</div>
            <div>5K pace: <b>{formatSeconds(selected.pace.k5)}</b> /mi</div>
          </div>
        </PaceCard>

        <PaceCard title="Recovery Running">
          <div><b>{formatSeconds(rec)}</b> /mi (5K + 1:50)</div>
        </PaceCard>

        <PaceCard title="Steady Running">
          <div><b>{formatSeconds(steady.low)}</b> to <b>{formatSeconds(steady.high)}</b> /mi (5K + 60–75s)</div>
        </PaceCard>

        <PaceCard title="Threshold">
          <div style={{ display: "grid", gap: 6 }}>
            <div>Mile pace: <b>{formatSeconds(thr.mile)}</b> /mi</div>
            <div>400 @ mile pace: <b>{formatSeconds(thr.m400)}</b></div>
            <div>100 @ mile pace: <b>{formatSeconds(thr.m100)}</b></div>
          </div>
        </PaceCard>

        <PaceCard title="Critical Velocity">
          <PaceTable rows={cvRows} />
        </PaceCard>

        <PaceCard title="Power Run">
          <div><b>{formatSeconds(power)}</b> /mi (2 Mile + :30)</div>
        </PaceCard>

        <PaceCard title="5K Pace Repeats">
          <PaceTable rows={fivekRows} />
        </PaceCard>

        <PaceCard title="2-Mile Pace Repeats">
          <PaceTable rows={speedRows} />
        </PaceCard>
      </div>
    );
  }, [selected]);

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
     <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
  <h1 style={{ fontSize: 28, marginBottom: 12 }}>
    {mode === "OTR" ? "On The Run Pace Calculator" : "UPrep Pace Calculator"}
  </h1>

  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
    <button
      onClick={() => setMode("OTR")}
      style={{
        padding: "8px 12px",
        borderRadius: 10,
        border: "1px solid #ccc",
        background: mode === "OTR" ? "#111" : "white",
        color: mode === "OTR" ? "white" : "#111",
        cursor: "pointer",
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
        cursor: "pointer",
      }}
    >
      UPREP
    </button>
  </div>
</div>


      <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12, background: "white" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Race distance</span>
            <select value={distance} onChange={(e) => setDistance(e.target.value as InputDistance)}>
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

  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
    <input
      value={timeStr}
      onChange={(e) => setTimeStr(e.target.value)}
      placeholder="e.g., 16:45"
      inputMode="numeric"
      style={{ padding: 8, border: "1px solid #ccc", borderRadius: 8, minWidth: 220 }}
    />

    <button
      onClick={async () => {
        if (!selected) return;
        const text = buildCopyText({ mode, selected });
        await navigator.clipboard.writeText(text);
        alert("Copied paces to clipboard");
      }}
      disabled={!selected}
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid #ccc",
        background: selected ? "#111" : "#eee",
        color: selected ? "white" : "#777",
        cursor: selected ? "pointer" : "not-allowed",
      }}
    >
      Copy Paces
    </button>

<button
  onClick={async () => {
    if (!selected || !resultsRef.current) return;

    const node = resultsRef.current;

    const dataUrl = await toPng(node, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: "#ffffff",
    });

    const link = document.createElement("a");
    link.download = `${mode}-PaceIndex-${selected.paceIndex}.png`;
    link.href = dataUrl;
    link.click();
  }}
  disabled={!selected}
  style={{
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ccc",
    background: selected ? "white" : "#eee",
    color: selected ? "#111" : "#777",
    cursor: selected ? "pointer" : "not-allowed",
  }}
>
  Save as Image
</button>

  </div>
</label>

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
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>
        {mode} • Pace Index {selected.paceIndex}
      </div>
      <div style={{ color: "#333", marginBottom: 10 }}>
        Input: {distance.toUpperCase()} {timeStr}
      </div>

      {/* this is your existing content grid */}
      {content}
    </>
  ) : (
    <p style={{ margin: 0, color: "#666" }}>Enter a distance and time to see your paces.</p>
  )}
</div>

    </main>
  );
}
