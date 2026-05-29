// Fix honors-as-major issue by re-parsing the full_education field
// Also fixes the school-as-major issue (Amine Bennouna)

const fs = require('fs');
const data = JSON.parse(fs.readFileSync('kellogg_faculty.json', 'utf-8'));

// ── Patterns ──────────────────────────────────────────────────────────────────
const HONORS_PATTERN = /^(Highest Honors|High Honors|Summa Cum Laude|Magna Cum Laude|Magna cum Laude|Magna cum laude|cum laude|Cum Laude|summa cum laude|magna cum laude|with Honors|Honors|with distinction|with Distinction|with honor|1st Class Honours?|First Class Honours?|Second Class Honours?|with Distinction|Distinction|Sigma Xi|Double First Class Honors?)$/i;

const SCHOOL_PATTERN = /University|College|Institut|School|Technology|Polytechnique|Ecole|École|Academia|Universit[aà]|Hochschule|Universidad|Università/i;

const BACHELOR_DEGREES = /^(B\.?A\.?|B\.?S\.?|B\.?E\.?|BSc|BSE|AB|ScB|BBA|B\.?Tech\.?|BTech|Bachelor|Bachelors|Bachelor of|Baccalaureate|B\.Bus\.?|A\.B\.?|B\.S\.E\.?|B\.Eng\.?|LLB|LL\.B\.?|B\.S\.|B\.A\.|BA \(hon\.\)|AB \(hon\.\))/i;

// ── HTML entity decode ────────────────────────────────────────────────────────
function decodeHtml(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

// ── Parse a single education entry ───────────────────────────────────────────
// Format: DEGREE, [YEAR], MAJOR..., SCHOOL, [HONORS...]
function parseEntry(entry) {
  entry = decodeHtml(entry).trim();
  const tokens = entry.split(', ').map(t => t.trim()).filter(Boolean);
  if (tokens.length < 2) return null;

  let i = 0;
  const degree = tokens[i++];

  // Second token: year?
  let year = null;
  if (/^\d{4}$/.test(tokens[i])) {
    year = parseInt(tokens[i], 10);
    i++;
  }

  const middle = tokens.slice(i);

  // Strip trailing honors tokens
  while (middle.length > 0 && HONORS_PATTERN.test(middle[middle.length - 1])) {
    middle.pop();
  }

  if (middle.length === 0) return { degree, year, major: null, school: null };

  // Find school: last token that looks like a school name
  let schoolIdx = -1;
  for (let j = middle.length - 1; j >= 0; j--) {
    if (SCHOOL_PATTERN.test(middle[j])) {
      schoolIdx = j;
      break;
    }
  }

  let school = null;
  let major = null;

  if (schoolIdx === -1) {
    // No school-like token found; if only one token, assume it's the major
    major = middle.join(', ') || null;
  } else if (schoolIdx === 0 && middle.length === 1) {
    // Only a school token, no major
    school = middle[0];
  } else {
    school = middle[schoolIdx];
    // Major = everything before the school token (skipping any other school-like duplicates)
    const majorParts = [];
    for (let j = 0; j < schoolIdx; j++) {
      // Skip tokens that look like the same school (truncated duplicates like "Universidad de San Andr")
      if (SCHOOL_PATTERN.test(middle[j]) && school && school.startsWith(middle[j].slice(0, 10))) continue;
      majorParts.push(middle[j]);
    }
    major = majorParts.length > 0 ? majorParts.join(', ') : null;
  }

  return { degree, year, major, school };
}

// ── Find the undergrad entry in full_education ─────────────────────────────
function findUndergradEntry(fullEd, undergradYear) {
  if (!fullEd || fullEd === 'Education section not found') return null;

  const entries = fullEd.split(' | ').map(e => e.trim());
  const parsed = entries.map(parseEntry).filter(Boolean);

  // Strategy 1: match by year
  if (undergradYear) {
    const byYear = parsed.find(p => p.year === undergradYear);
    if (byYear) return byYear;
  }

  // Strategy 2: find bachelor-level entries
  const bachelorEntries = parsed.filter(p => BACHELOR_DEGREES.test(p.degree));
  if (bachelorEntries.length === 0) return null;

  // Take the earliest bachelor entry
  bachelorEntries.sort((a, b) => (a.year || 9999) - (b.year || 9999));
  return bachelorEntries[0];
}

// ── Main fix loop ─────────────────────────────────────────────────────────────
const BAD_MAJOR_PATTERN = /^(Highest Honors|High Honors|Summa Cum Laude|Magna Cum Laude|Magna cum Laude|Magna cum laude|cum laude|Cum Laude|summa cum laude|magna cum laude|with Honors|Honors|with distinction|with Distinction|with honor|Distinction)$/i;
const SCHOOL_AS_MAJOR = /University|College|Institut|School|Technology|Polytechnique|Ecole|Universidad/i;

let fixed = 0;
let couldNotFix = [];

data.forEach(prof => {
  const badMajor = prof.undergrad_major && (BAD_MAJOR_PATTERN.test(prof.undergrad_major) || SCHOOL_AS_MAJOR.test(prof.undergrad_major));
  if (!badMajor) return;

  const parsed = findUndergradEntry(prof.full_education, prof.undergrad_year);
  if (!parsed) {
    couldNotFix.push({ name: prof.name, reason: 'Could not find undergrad entry in full_education' });
    return;
  }

  const oldMajor = prof.undergrad_major;
  const newMajor = parsed.major || null;
  const newSchool = parsed.school || null;

  // Update school too if it was null and we found one
  if (!prof.undergrad_school && newSchool) {
    prof.undergrad_school = newSchool;
  }
  prof.undergrad_major = newMajor;

  console.log(`✅ ${prof.name}`);
  console.log(`   Major: "${oldMajor}" → "${newMajor}"`);
  if (!prof.undergrad_school && newSchool) console.log(`   School: null → "${newSchool}"`);
  fixed++;
});

// Write back
fs.writeFileSync('kellogg_faculty.json', JSON.stringify(data, null, 2), 'utf-8');

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Fixed: ${fixed} professors`);
if (couldNotFix.length > 0) {
  console.log(`Could not fix: ${couldNotFix.length}`);
  couldNotFix.forEach(p => console.log(`  ⚠️  ${p.name}: ${p.reason}`));
}

// Validate JSON
JSON.parse(fs.readFileSync('kellogg_faculty.json', 'utf-8'));
console.log(`✅ File is valid JSON`);
