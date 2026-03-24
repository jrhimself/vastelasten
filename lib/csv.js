export function parseEuropeanAmount(str) {
  if (!str) return null;
  str = str.trim().replace(/['"]/g, '');
  if (str.includes(',') && str.includes('.')) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (str.includes(',')) {
    str = str.replace(',', '.');
  }
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

export function parseDate(str) {
  if (!str) return null;
  str = str.trim();
  let m = str.match(/^(\d{2})[.\-\/](\d{2})[.\-\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = str.match(/^(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export function splitCSVRow(line, delim) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function detectDelimiter(text) {
  const line = text.split('\n')[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && counts[ch] !== undefined) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

export function parseCSV(text) {
  const delim = detectDelimiter(text);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (splitCSVRow(lines[i], delim).length >= 3) { headerIdx = i; break; }
  }
  const headers = splitCSVRow(lines[headerIdx], delim).map(h => h.replace(/['"]/g, '').toLowerCase());
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = splitCSVRow(lines[i], delim);
    if (cols.length < 2) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] || ''; });
    rows.push(row);
  }
  return rows;
}
