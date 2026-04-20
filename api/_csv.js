// RFC-4180 CSV line parser extracted from power-plants.js so multiple
// routes can share it. Handles quoted fields, escaped quotes (""), and
// embedded commas inside quoted fields. Does NOT handle newlines inside
// quoted fields — callers split on \r?\n before calling.

export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"' && cur === '') inQuotes = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
