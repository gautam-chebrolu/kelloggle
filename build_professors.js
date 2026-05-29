// Final cleanup pass + generate professors.js
// Fixes: campus-as-major, honor-society-as-major, HTML entities, AI-error years, bad school+major splits

const fs = require('fs');
const data = JSON.parse(fs.readFileSync('kellogg_faculty.json', 'utf-8'));

// HTML entity decode
function decodeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// Patterns for values that are clearly NOT a major
const NOT_A_MAJOR = [
  // Campuses stored as major when school was "University of California" / "State University of New York"
  /^(Berkeley|Irvine|Davis|San Diego|Santa Barbara|Los Angeles|Santa Cruz|Riverside|Cortland|Buffalo|Albany|Binghamton|Stony Brook|Oswego|Brockport)$/i,
  // Honor societies / Latin honors
  /^(Phi Beta Kappa|Phi Beta Kappa|Dean['']?s List.*)$/i,
  // Valedictorian / president's medal type strings
  /^(President['']?s Medal.*|Valedictorian.*)$/i,
  // AI error text that leaked into year field
  /I do not have enough information/i,
  // School names that leaked in
  /University|College|Institut|School|Polytechnique|Ecole|KU Leuven|Universit[aà]/i,
];

const NOT_A_YEAR = /I do not have enough information/i;

let fixCount = 0;

data.forEach(prof => {
  // Decode HTML entities in string fields
  ['name','department','tenure','highest_degree','highest_degree_school',
   'undergrad_school','undergrad_major'].forEach(k => {
    if (typeof prof[k] === 'string') prof[k] = decodeHtml(prof[k]);
  });

  // Fix bad years (AI error text)
  ['highest_degree_year','undergrad_year'].forEach(k => {
    if (typeof prof[k] === 'string' && NOT_A_YEAR.test(prof[k])) {
      console.log(`  Year fix: ${prof.name} [${k}] "${prof[k].slice(0,40)}..." → null`);
      prof[k] = null;
      fixCount++;
    }
    // Also parse any remaining string years
    if (typeof prof[k] === 'string' && /^\d{4}$/.test(prof[k])) {
      prof[k] = parseInt(prof[k], 10);
    }
  });

  // Fix campus/honor-society leaking as undergrad_major
  if (prof.undergrad_major && NOT_A_MAJOR.some(p => p.test(prof.undergrad_major))) {
    // Try to reconstruct: campus → append to school, then null the major
    const campus = prof.undergrad_major;
    if (/^(Berkeley|Irvine|Davis|San Diego|Santa Barbara|Los Angeles|Santa Cruz|Riverside|Cortland|Buffalo|Albany|Binghamton|Stony Brook|Oswego|Brockport)$/i.test(campus)) {
      if (prof.undergrad_school) {
        const newSchool = `${prof.undergrad_school}, ${campus}`;
        console.log(`  Campus fix: ${prof.name} → school "${prof.undergrad_school}" → "${newSchool}", major → null`);
        prof.undergrad_school = newSchool;
      }
    } else {
      console.log(`  Major fix: ${prof.name} → major "${prof.undergrad_major}" → null`);
    }
    prof.undergrad_major = null;
    fixCount++;
  }
});

console.log(`\nTotal additional fixes: ${fixCount}`);

// Write back cleaned JSON
fs.writeFileSync('kellogg_faculty.json', JSON.stringify(data, null, 2), 'utf-8');

// Now generate professors.js with only game-relevant fields
const GAME_FIELDS = [
  'name', 'department', 'tenure',
  'highest_degree', 'highest_degree_year', 'highest_degree_school',
  'undergrad_year', 'undergrad_school', 'undergrad_major'
];

const professors = data.map(p => {
  const entry = {};
  GAME_FIELDS.forEach(k => {
    entry[k] = (p[k] !== undefined && p[k] !== '') ? p[k] : null;
  });
  if (p['images/mobile1X']) {
    entry.image = 'https://kellogg.northwestern.edu' + p['images/mobile1X'];
  } else {
    entry.image = null;
  }
  return entry;
});

const output = `/* ═══════════════════════════════════════════════
   ProfGuess — professors.js
   Auto-generated from kellogg_faculty.json
   ${professors.length} Kellogg faculty members
   ═══════════════════════════════════════════════ */

const PROFESSORS = ${JSON.stringify(professors, null, 2)};
`;

fs.writeFileSync('professors.js', output, 'utf-8');
// Validation check skipped

console.log(`\n✅ professors.js written — ${professors.length} professors`);
const withDeg   = professors.filter(p => p.highest_degree).length;
const withUGrad = professors.filter(p => p.undergrad_school).length;
const withMajor = professors.filter(p => p.undergrad_major).length;
console.log(`   Have highest degree: ${withDeg}/${professors.length}`);
console.log(`   Have undergrad school: ${withUGrad}/${professors.length}`);
console.log(`   Have undergrad major: ${withMajor}/${professors.length}`);
