const fs = require("fs");
const Papa = require("papaparse");

const csv = fs.readFileSync("OTR Pace.xlsx - VDOT.csv", "utf8");
const parsed = Papa.parse(csv, { skipEmptyLines: false });
const all = parsed.data;

// Keep ONLY rows that have a numeric Pace Index in column L (index 11)
const rows = all.filter((r) => {
  const v = Number(String(r?.[11] ?? "").trim());
  return Number.isFinite(v) && v > 0;
});

/**
 * Parse mm:ss or mm:ss:cc (centiseconds)
 * Examples:
 *  - 18:05 -> 1085 sec
 *  - 18:05:00 -> 1085.00 sec
 *  - 5:49:13 -> 349.13 sec
 */
function parseMsCsToSeconds(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;

  if (s.includes(":")) {
    const parts = s.split(":").map((x) => x.trim());
    const nums = parts.map(Number);
    if (nums.some((n) => Number.isNaN(n))) return null;

    if (nums.length === 2) {
      const [mm, ss] = nums;
      return mm * 60 + ss;
    }
    if (nums.length === 3) {
      const [mm, ss, cc] = nums; // cc = hundredths
      return mm * 60 + ss + cc / 100;
    }
    return null;
  }

  // numeric fallback
  const num = Number(s);
  if (Number.isNaN(num)) return null;

  // excel day fraction
  if (num > 0 && num < 1) return num * 86400;

  // decimal minutes
  return num * 60;
}

/**
 * Parse h:mm:ss (used for Half/Marathon predictions)
 * Examples:
 *  - 1:22:59 -> 4979 sec
 *  - 2:53:17 -> 10397 sec
 */
function parseHmsToSeconds(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;

  if (s.includes(":")) {
    const parts = s.split(":").map((x) => x.trim());
    const nums = parts.map(Number);
    if (nums.some((n) => Number.isNaN(n))) return null;

    if (nums.length === 3) {
      const [h, m, sec] = nums;
      return h * 3600 + m * 60 + sec;
    }
    if (nums.length === 2) {
      const [m, sec] = nums;
      return m * 60 + sec;
    }
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

const data = rows
  .map((r, i) => {
    const paceIndex = Number(String(r[11]).trim());
    if (!Number.isFinite(paceIndex)) return null;

    return {
      id: i,
      paceIndex,
      label: `PI ${paceIndex}`,

      // Race Predictions (TOTAL race time)
      pred: {
        m800: whole(parseMsCsToSeconds(r[2])),
        mile: whole(parseMsCsToSeconds(r[3])),
        twoMile: whole(parseMsCsToSeconds(r[4])),
        k5: whole(parseMsCsToSeconds(r[5])),
        half: whole(parseHmsToSeconds(r[6])),
        marathon: whole(parseHmsToSeconds(r[7])),
      },

      // Race Paces (/mi) from sheet
      pace: {
        mile: whole(parseMsCsToSeconds(r[8])),
        twoMile: whole(parseMsCsToSeconds(r[9])),
        k5: whole(parseMsCsToSeconds(r[10])),
      },

      // Critical Velocity reps (these appear to be ms:cs format in your export)
      cv: {
        m100: whole(parseMsCsToSeconds(r[32])),
        m400: whole(parseMsCsToSeconds(r[31])),
        m800: whole(parseMsCsToSeconds(r[30])),
        m1000: whole(parseMsCsToSeconds(r[29])),
        m1200: whole(parseMsCsToSeconds(r[28])),
      },

      // 2 Mile pace repeats (ms:cs)
      speed2m: {
        m100: whole(parseMsCsToSeconds(r[37])),
        m200: whole(parseMsCsToSeconds(r[36])),
        m300: whole(parseMsCsToSeconds(r[35])),
        m400: whole(parseMsCsToSeconds(r[34])),
        m600: whole(parseMsCsToSeconds(r[33])),
      },
    };
  })
  .filter(Boolean)
  .filter((x) => Number.isFinite(x.pred?.k5) && Number.isFinite(x.pace?.k5));

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/paces.json", JSON.stringify(data, null, 2));
console.log("✓ Created data/paces.json with", data.length, "rows");
