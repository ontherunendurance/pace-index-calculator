const fs = require("fs");
const Papa = require("papaparse");

// Read CSV
const csv = fs.readFileSync("OTR Pace.xlsx - VDOT.csv", "utf8");
const parsed = Papa.parse(csv, { skipEmptyLines: true });
const rows = parsed.data.slice(1);

/**
 * Parse a time-like value into SECONDS (may be fractional),
 * supporting:
 * - mm:ss
 * - mm:ss.cc
 * - mm:ss:cc   (your CSV like 5:49:13 meaning 5:49.13)
 * - Excel day fractions (0 < x < 1)
 * - decimal minutes (6.5 => 6:30)
 */
function parseToSeconds(v) {
  if (v === undefined || v === null) return null;

  const s = v.toString().trim();
  if (!s) return null;

  // If it contains ":", it's time-ish
  if (s.includes(":")) {
    const parts = s.split(":").map((x) => x.trim());

    // Support mm:ss.cc where seconds contain decimals
    if (parts.length === 2 && parts[1].includes(".")) {
      const mm = Number(parts[0]);
      const sec = Number(parts[1]);
      if (Number.isNaN(mm) || Number.isNaN(sec)) return null;
      return mm * 60 + sec;
    }

    const nums = parts.map(Number);
    if (nums.some((n) => Number.isNaN(n))) return null;

    // mm:ss
    if (nums.length === 2) {
      return nums[0] * 60 + nums[1];
    }

    // mm:ss:cc  (centiseconds)
    if (nums.length === 3) {
      const mm = nums[0];
      const ss = nums[1];
      const cc = nums[2]; // hundredths
      return mm * 60 + ss + cc / 100;
    }

    // If some row has h:mm:ss (rare), you can extend later.
    return null;
  }

  // Numeric fallback
  const num = Number(s);
  if (Number.isNaN(num)) return null;

  // Excel time as fraction of a day
  if (num > 0 && num < 1) {
    return num * 86400;
  }

  // Otherwise treat as decimal minutes
  return num * 60;
}

/**
 * Ensure final stored value is an integer number of seconds.
 * Also fixes "centiseconds accidentally treated as seconds" cases:
 * if a value is way too large to be seconds for a split/pace,
 * interpret it as centiseconds and divide by 100.
 */
function toWholeSeconds(v) {
  const sec = parseToSeconds(v);
  if (sec === null) return null;

  // If it's huge, it's almost certainly centiseconds already (e.g., 20953)
  // A pace/split in seconds should almost never exceed 2000 for our use.
  const normalized = sec > 2000 ? sec / 100 : sec;

  return Math.round(normalized);
}

const data = rows
  .map((r, i) => {
    const paceIndex = Number(r[11]); // Column L (0-based index 11)
    if (!Number.isFinite(paceIndex)) return null;

    return {
      id: i,
      paceIndex,
      label: `PI ${paceIndex}`,

      pred: {
  m800: toWholeSeconds(r[2]),
  mile: toWholeSeconds(r[3]),
  twoMile: toWholeSeconds(r[4]),
  k5: toWholeSeconds(r[5]),
  half: toWholeSeconds(r[6]),
  marathon: toWholeSeconds(r[7]),
},

      pace: {
        mile: toWholeSeconds(r[8]),
        twoMile: toWholeSeconds(r[9]),
        k5: toWholeSeconds(r[10]),
      },

      cv: {
        m100: toWholeSeconds(r[32]),
        m400: toWholeSeconds(r[31]),
        m800: toWholeSeconds(r[30]),
        m1000: toWholeSeconds(r[29]),
        m1200: toWholeSeconds(r[28]),
      },

      speed2m: {
        m100: toWholeSeconds(r[37]),
        m200: toWholeSeconds(r[36]),
        m300: toWholeSeconds(r[35]),
        m400: toWholeSeconds(r[34]),
        m600: toWholeSeconds(r[33]),
      },
    };
  })
  .filter(Boolean)
  .filter((x) => x.pace && Number.isFinite(x.pace.k5));

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/paces.json", JSON.stringify(data, null, 2));
console.log("✓ Created data/paces.json with", data.length, "rows");
