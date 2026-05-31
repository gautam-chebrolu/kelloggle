const fs = require('fs');
const data = JSON.parse(fs.readFileSync('kellogg_faculty.json', 'utf-8'));

const HONORS_PATTERN = /^(Highest Honors|High Honors|Summa Cum Laude|Magna Cum Laude|Magna cum Laude|Magna cum laude|cum laude|Cum Laude|summa cum laude|magna cum laude|with Honors|Honors|with distinction|with Distinction|with honor|1st Class Honours?|First Class Honours?|Second Class Honours?|Third Class Honours?|with Distinction|Distinction|Sigma Xi|Double First Class Honors?|Dean['']s List|Dean['']s list|First class honours?|Second class honours?)$/i;

// Removed Berkeley since it is a campus, which we append dynamically
const SCHOOL_PATTERN = /University|College|Institut|School|Technology|Polytechnique|Ecole|École|Academia|Universit[aà]|Hochschule|Universidad|Università|Leuven|Oxford|Cambridge|Princeton|Harvard|Stanford|Yale|MIT|IIT|Caltech|LSE|INSEAD|Dartmouth|Cornell|Columbia|Wharton|Northwestern|Williams|Amherst|Wellesley|Swarthmore/i;

const CAMPUSES = /^(Berkeley|Irvine|Davis|San Diego|Santa Barbara|Los Angeles|Santa Cruz|Riverside|Cortland|Buffalo|Albany|Binghamton|Stony Brook|Oswego|Brockport|St\. Louis|Bloomington|College Park|Amherst|Ann Arbor|Urbana-Champaign|Chapel Hill|Austin|Madison)$/i;

const LOCATIONS = /^(India|UK|USA|United Kingdom|United States|Germany|France|Italy|Spain|Canada|Japan|Brazil|Belgium|Switzerland|Netherlands|Israel|Chile|Singapore|China|South Korea|Australia|Hong Kong|Sweden|Norway|Finland|Denmark|Ireland|Mexico|Argentina|Taiwan)$/i;

const BACHELOR_DEGREES = /^(B\.?A\.?|B\.?S\.?|B\.?E\.?|BSc|BSE|AB|ScB|BBA|B\.?Tech\.?|BTech|Bachelor|Bachelors|Bachelor of|Baccalaureate|B\.Bus\.?|A\.B\.?|B\.S\.E\.?|B\.Eng\.?|LLB|LL\.B\.?|B\.S\.|B\.A\.|BA \(hon\.\)|AB \(hon\.\)|S\.B\.?|SB|Diplom|Laurea|Licenciatura|Lic\.Rer\.Pol\.|Licence|Vordiplom|B\.Com|BCom)/i;

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

function parseEntry(entry) {
  entry = decodeHtml(entry).trim();
  const tokens = entry.split(', ').map(t => t.trim()).filter(Boolean);
  if (tokens.length === 0) return null;

  // 1. Robust Year Extraction
  let year = null;
  const yearIdx = tokens.findIndex((t, idx) => idx > 0 && idx < 4 && /^\d{4}$/.test(t));
  if (yearIdx !== -1) {
    year = parseInt(tokens[yearIdx], 10);
    tokens.splice(yearIdx, 1);
  }

  if (tokens.length < 2) {
    if (tokens.length === 1 && SCHOOL_PATTERN.test(tokens[0])) {
      return { degree: null, year, major: null, school: tokens[0] };
    }
    return null;
  }

  const degree = tokens[0];
  const middle = tokens.slice(1);

  // Strip trailing honors
  while (middle.length > 0 && (HONORS_PATTERN.test(middle[middle.length - 1]) || /Dean's/i.test(middle[middle.length - 1]))) {
    middle.pop();
  }

  if (middle.length === 0) return { degree, year, major: null, school: null };

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
    major = middle.join(', ') || null;
  } else if (schoolIdx === 0 && middle.length === 1) {
    school = middle[0];
  } else {
    school = middle[schoolIdx];
    
    // Check if subsequent tokens are campuses or locations, and append them
    let nextIdx = schoolIdx + 1;
    while (nextIdx < middle.length) {
      const nextToken = middle[nextIdx];
      if (CAMPUSES.test(nextToken) || LOCATIONS.test(nextToken)) {
        school = `${school}, ${nextToken}`;
        nextIdx++;
      } else {
        break;
      }
    }

    const majorParts = [];
    for (let j = 0; j < schoolIdx; j++) {
      if (SCHOOL_PATTERN.test(middle[j]) && school && school.startsWith(middle[j].slice(0, 10))) continue;
      majorParts.push(middle[j]);
    }
    major = majorParts.length > 0 ? majorParts.join(', ') : null;
  }

  if (major && HONORS_PATTERN.test(major)) {
    major = null;
  }

  return { degree, year, major, school };
}

function findUndergradEntry(fullEd, undergradYear) {
  if (!fullEd || fullEd === 'Education section not found') return null;

  const entries = fullEd.split(' | ').map(e => e.trim());
  const parsed = entries.map(parseEntry).filter(Boolean);

  // Strategy 1: Find bachelor-level entries first
  const bachelorEntries = parsed.filter(p => p.degree && BACHELOR_DEGREES.test(p.degree));
  if (bachelorEntries.length > 0) {
    bachelorEntries.sort((a, b) => (a.year || 9999) - (b.year || 9999));
    return bachelorEntries[0];
  }

  // Strategy 2: Match by year
  if (undergradYear && typeof undergradYear === 'number') {
    const byYear = parsed.find(p => p.year === undergradYear);
    if (byYear) return byYear;
  }

  // Strategy 3: Earliest non-graduate entry
  const nonGraduate = parsed.filter(p => p.degree && !/^(PhD|Ph\.D\.|M\.?S\.?|M\.?A\.?|MBA|M\.?B\.?A\.?|M\.?Phil\.?|JD|J\.?D\.|MD|M\.?D\.)/i.test(p.degree));
  if (nonGraduate.length > 0) {
    nonGraduate.sort((a, b) => (a.year || 9999) - (b.year || 9999));
    return nonGraduate[0];
  }

  if (parsed.length > 0) {
    return parsed[parsed.length - 1];
  }

  return null;
}

let dryRunDiffs = 0;

data.forEach(prof => {
  const parsed = findUndergradEntry(prof.full_education, prof.undergrad_year);
  if (!parsed) return;

  const changes = [];
  if (parsed.school && prof.undergrad_school !== parsed.school) {
    changes.push(`School: "${prof.undergrad_school}" -> "${parsed.school}"`);
  }
  if (parsed.year && prof.undergrad_year !== parsed.year) {
    changes.push(`Year:   "${prof.undergrad_year}" -> "${parsed.year}"`);
  }
  if (parsed.major && prof.undergrad_major !== parsed.major) {
    if (!HONORS_PATTERN.test(parsed.major)) {
      changes.push(`Major:  "${prof.undergrad_major}" -> "${parsed.major}"`);
    }
  }

  if (changes.length > 0) {
    console.log(`Potential Update for [${prof.name}]:`);
    changes.forEach(c => console.log(`  ${c}`));
    console.log(`  Source: ${prof.full_education}`);
    console.log('---');
    dryRunDiffs++;
  }
});

console.log(`Total professors with discrepancies: ${dryRunDiffs}`);
