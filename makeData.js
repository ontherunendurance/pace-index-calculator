const fs = require("fs");
const Papa = require("papaparse");

// ✅ Pace Overview CSV (PI 30–73)
const csv = fs.readFileSync("OTR Pace Overview Chart.xlsx - VDOT.csv", "utf8");
const parsed = Papa.parse(csv, { skipEmptyLines: false });
const all = parsed.data;

// Row 0 blank, Row 1 section labels, Row 2 headers, Row 3+ data
const rows = all.slice(3).filter((r) => r && String(r[0] ?? "").trim());

/**
 * Parse mm:ss or mm:ss:cc (centiseconds)
 * Examples:
 *  - 4:52:30 -> 292.30 sec
 *  - 0:18:45 -> 18.45 sec
 */
function parseMsCsToSeconds(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;

  if (s.includes(":")) {
    const parts = s.split(":").map((x) => x.trim());
    const nums = parts.map(Number);
    if (nums.some((n) => Number.isNaN(n))) return null;

    if (nums.length === 2) return nums[0] * 60 + nums[1];
    if (nums.length === 3) return nums[0] * 60 + nums[1] + nums[2] / 100;
    return null;
  }

  const num = Number(s);
  if (Number.isNaN(num)) return null;

  // excel day fraction
  if (num > 0 && num < 1) return num * 86400;

  // decimal minutes
  return num * 60;
}

/**
 * Parse h:mm:ss (Half/Marathon predictions)
 * Examples:
 *  - 1:05:53 -> seconds
 */
function parseHmsToSeconds(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;

  if (s.includes(":")) {
    const parts = s.split(":").map((x) => x.trim());
    const nums = parts.map(Number);
    if (nums.some((n) => Number.isNaN(n))) return null;

    if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2]; // h:mm:ss
    if (nums.length === 2) return nums[0] * 60 + nums[1]; // mm:ss
    return null;
  }

  const num = Number(s);
  if (Number.isNaN(num)) return null;
  if (num > 0 && num < 1) return num * 86400;
  return num * 60;
}

function whole(sec) {
  if (sec == null) return null;
  return Math.round(sec);
}

/**
 * Column map from your printed ROW2 (0-based):
 * 0  INDEX
 * 1  800 (prediction)
 * 2  1 mi (prediction)
 * 3  2 mi (prediction)
 * 4  5k (prediction)
 * 5  Half (prediction)  h:mm:ss
 * 6  Marathon (prediction) h:mm:ss
 * 7  1 mile (race pace /mi)
 * 8  2 mile (race pace /mi)
 * 9  5k (race pace /mi)
 * 10 Recovery (pace /mi)  (you may ignore in app if rule-based)
 * 11 Steady (pace /mi)    (you may ignore in app if rule-based)
 * 12 Range (pace /mi)     (optional)
 * 13 Threshold Pace (pace /mi)  ✅ we need this
 * 20 Run (Power run pace /mi)   (optional if you compute from 2mi+30)
 * 21-25 Critical Velocity reps: 400,800,1000,1200,mile
 * 26-31 5k Pace Repeats: 1600,1200,1k,800,400,100 ✅ we need these
 * 32-36 2 Mile Pace Repeats: 600,400,300,200,100
 */

const data = rows
  .map((r, i) => {
    const paceIndex = Number(String(r[0]).trim());
    if (!Number.isFinite(paceIndex)) return null;

    // Race Predictions (TOTAL time)
    const pred800 = whole(parseMsCsToSeconds(r[1]));
    const predMile = whole(parseMsCsToSeconds(r[2]));
    const pred2M = whole(parseMsCsToSeconds(r[3]));
    const pred5k = whole(parseMsCsToSeconds(r[4]));
    const predHalf = whole(parseHmsToSeconds(r[5]));
    const predMar = whole(parseHmsToSeconds(r[6]));

    // Race paces (/mi)
    const paceMile = whole(parseMsCsToSeconds(r[7]));
    const pace2M = whole(parseMsCsToSeconds(r[8]));
    const pace5k = whole(parseMsCsToSeconds(r[9]));

    // Threshold pace (/mi) — pull directly from chart
    const thresholdPace = whole(parseMsCsToSeconds(r[19]));


    // CV reps (seconds per rep)
    const cv400 = whole(parseMsCsToSeconds(r[21]));
    const cv800 = whole(parseMsCsToSeconds(r[22]));
    const cv1000 = whole(parseMsCsToSeconds(r[23]));
    const cv1200 = whole(parseMsCsToSeconds(r[24]));
    const cv1600 = whole(parseMsCsToSeconds(r[25]));
    const cv100 = cv400 != null ? Math.round(cv400 / 4) : null; // derive 100 from 400

    // 5k pace repeats — pull directly from chart
    const fivekRepeats = {
      m1600: whole(parseMsCsToSeconds(r[26])),
      m1200: whole(parseMsCsToSeconds(r[27])),
      m1000: whole(parseMsCsToSeconds(r[28])),
      m800: whole(parseMsCsToSeconds(r[29])),
      m400: whole(parseMsCsToSeconds(r[30])),
      m100: whole(parseMsCsToSeconds(r[31])),
    };

    // 2 mile pace repeats (seconds per rep)
    const speed2m = {
      m600: whole(parseMsCsToSeconds(r[32])),
      m400: whole(parseMsCsToSeconds(r[33])),
      m300: whole(parseMsCsToSeconds(r[34])),
      m200: whole(parseMsCsToSeconds(r[35])),
      m100: whole(parseMsCsToSeconds(r[36])),
    };

    return {
      id: i,
      paceIndex,
      label: `PI ${paceIndex}`,

      pred: {
        m800: pred800,
        mile: predMile,
        twoMile: pred2M,
        k5: pred5k,
        half: predHalf,
        marathon: predMar,
      },

      pace: {
        mile: paceMile,
        twoMile: pace2M,
        k5: pace5k,
      },

      // ✅ exact threshold pace from chart
      thresholdPace,

      // ✅ exact 5k repeats from chart
      fivekRepeats,

      cv: {
        m100: cv100,
        m400: cv400,
        m800: cv800,
        m1000: cv1000,
        m1200: cv1200,
        m1600: cv1600,
      },

      speed2m,
    };
  })
  .filter(Boolean)
  .filter((x) => x.paceIndex >= 30 && x.paceIndex <= 73);

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/paces.json", JSON.stringify(data, null, 2));
console.log("✓ Created data/paces.json with", data.length, "rows");
