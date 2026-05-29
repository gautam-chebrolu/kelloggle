// Preview the full_education field for all 43 honors-as-major professors
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('kellogg_faculty.json', 'utf-8'));

const HONORS_PATTERN = /^(Highest Honors|High Honors|Summa Cum Laude|Magna Cum Laude|Magna cum Laude|Magna cum laude|cum laude|Cum Laude|summa cum laude|magna cum laude|with Honors|Honors|with distinction|with Distinction|1st Class|First Class|with honor)$/i;
const SCHOOL_PATTERN = /University|College|Institute|School|Polytechnique|Ecole/i;

const affected = data.filter(p =>
  (p.undergrad_major && (HONORS_PATTERN.test(p.undergrad_major) || SCHOOL_PATTERN.test(p.undergrad_major)))
);

console.log(`Affected professors: ${affected.length}\n`);
affected.forEach(p => {
  console.log(`Name:          ${p.name}`);
  console.log(`Bad major:     ${p.undergrad_major}`);
  console.log(`full_education: ${p.full_education}`);
  console.log('---');
});
