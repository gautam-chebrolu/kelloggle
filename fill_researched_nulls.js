
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('kellogg_faculty.json', 'utf8'));

// Map of professor name -> { undergrad_school, year, major }
// Only set fields where we have confident data; null means "leave existing value or keep null"
const updates = {
  "Chethana Achar": {
    undergrad_school: "T.A. Pai Management Institute (TAPMI)",
    year: 2009,
    major: "Management"
  },
  "Matthew Allen": {
    undergrad_school: "University of Utah",
    year: null,
    major: "Accounting"
  },
  "Mark Angelson": {
    undergrad_school: "Rutgers College",
    year: 1972,
    major: null
  },
  "Guy Aridor": {
    undergrad_school: "Boston University",
    year: 2014,
    major: "Computer Science, Mathematics, and Economics"
  },
  "Gail Berger": {
    undergrad_school: "Boston University",
    year: 1997,
    major: "Psychology and Elementary Education"
  },
  "Jeffrey Berk": {
    undergrad_school: "University of Kansas",
    year: 1993,
    major: "Business and Accounting"
  },
  "William Brady": {
    undergrad_school: "University of North Carolina at Chapel Hill",
    year: null,
    major: "Psychology and Philosophy"
  },
  "Ellen Oglesby Carr": {
    undergrad_school: "Harvard College",
    year: 1994,
    major: null
  },
  "Tessa Charlesworth": {
    undergrad_school: "Columbia University",
    year: 2016,
    major: "Psychology"
  },
  "David Chen": {
    undergrad_school: "University of California, Berkeley",
    year: null,
    major: "Biology"
  },
  "Leslie DeChurch": {
    undergrad_school: "University of Miami",
    year: null,
    major: "Environmental Science"
  },
  "Erika Deserranno": {
    undergrad_school: "Université Libre de Bruxelles",
    year: 2006,
    major: "Business Engineering"
  },
  "Lauren Eskreis-Winkler": {
    undergrad_school: "University of Pennsylvania",
    year: 2009,
    major: "Psychology"
  },
  "Andres Espitia": {
    undergrad_school: "Universidad del Rosario",
    year: 2012,
    major: "Finance"
  },
  "Andrew Fano": {
    undergrad_school: "Vassar College",
    year: null,
    major: "Cognitive Science"
  },
  "Benjamin Grant": {
    undergrad_school: "University of Cincinnati",
    year: null,
    major: "Mathematics"
  },
  "Jonathan Guryan": {
    undergrad_school: "Princeton University",
    year: 1996,
    major: "Economics"
  },
  "Tom Hagenberg": {
    undergrad_school: "Indiana University",
    year: null,
    major: "Accounting"
  },
  "Leander Heldring": {
    undergrad_school: "Radboud University Nijmegen",
    year: 2010,
    major: "Economics"
  },
  "Anthony Hrusovsky": {
    undergrad_school: "University of Michigan",
    year: null,
    major: "Architecture"
  },
  "Ashlee Humphreys": {
    undergrad_school: "Northwestern University",
    year: 2003,
    major: "Economics and Philosophy"
  },
  "Daniela Hurtado Lange": {
    undergrad_school: "Pontificia Universidad Católica de Chile",
    year: null,
    major: "Industrial Engineering and Mathematics"
  },
  "Kylie Jiwon Hwang": {
    undergrad_school: "Seoul National University",
    year: null,
    major: "Business and Economics"
  },
  "Seyed Iravani": {
    undergrad_school: "Iran University of Science and Technology",
    year: null,
    major: "Industrial and System Engineering"
  },
  "Jeff Jacobson": {
    undergrad_school: "Stanford University",
    year: null,
    major: null
  },
  "Alexander Jakobsen": {
    undergrad_school: "University of Calgary",
    year: null,
    major: "Economics"
  },
  "Richard Jolly": {
    undergrad_school: "London Business School",
    year: null,
    major: "Business Administration (MBA)"
  },
  "Jung Min Kim": {
    undergrad_school: "Seoul National University",
    year: null,
    major: "Business and Economics"
  },
  "Linda Kim": {
    undergrad_school: "Northwestern University",
    year: 1999,
    major: "Engineering"
  },
  "Paul D. Leinwand": {
    undergrad_school: "Washington University in St. Louis",
    year: null,
    major: "Political Science"
  },
  "Eric Letsinger": {
    undergrad_school: "Northwestern University",
    year: null,
    major: "Urban Studies and Political Science"
  },
  "Matthew Levatich": {
    undergrad_school: "Rensselaer Polytechnic Institute",
    year: null,
    major: "Mechanical Engineering"
  },
  "Erez Levy": {
    undergrad_school: "Tel Aviv University",
    year: null,
    major: "Economics"
  },
  "Suraj Malladi": {
    undergrad_school: "University of Chicago",
    year: 2014,
    major: "Mathematics and Economics"
  },
  "Sébastien Martin": {
    undergrad_school: "École Polytechnique",
    year: null,
    major: "Applied Mathematics"
  },
  "Andrew McKinley": {
    undergrad_school: "Loyola University Chicago",
    year: 2013,
    major: "Philosophy"
  },
  "Stuart Meyer": {
    undergrad_school: "Columbia University",
    year: null,
    major: null
  },
  "Hiromichi (Hiro) Mizuno": {
    undergrad_school: "Osaka City University",
    year: null,
    major: "Law"
  },
  "Pooya Molavi": {
    undergrad_school: "Sharif University of Technology",
    year: 2008,
    major: "Electrical Engineering"
  },
  "Ilya Morozov": {
    undergrad_school: "Higher School of Economics (HSE)",
    year: null,
    major: "Economics"
  },
  "Kieu-Trang Nguyen": {
    undergrad_school: null,  // could not find
    year: null,
    major: null
  },
  "Chika Okafor": {
    undergrad_school: "Stanford University",
    year: null,
    major: "Economics"
  },
  "Julio M. Ottino": {
    undergrad_school: "National University of La Plata",
    year: 1974,
    major: "Chemical Engineering"
  },
  "Petros Paranikas": {
    undergrad_school: "Democritus University of Thrace",
    year: 1990,
    major: "Law"
  },
  "Jennifer Pendergast": {
    undergrad_school: "University of Virginia",
    year: null,
    major: "Finance"
  },
  "Nicola Persico": {
    undergrad_school: "Bocconi University",
    year: 1991,
    major: "Economics"
  },
  "Matthew Alexander Phillips": {
    undergrad_school: "University of Miami",
    year: null,
    major: null
  },
  "Luis Rayo": {
    undergrad_school: "Instituto Tecnológico Autónomo de México (ITAM)",
    year: 1998,
    major: "Economics"
  },
  "Srinivas Karempudi Reddy": {
    undergrad_school: null,  // could not find
    year: null,
    major: null
  },
  "Matthew Roling": {
    undergrad_school: "University of Wisconsin-Madison",
    year: null,
    major: null
  },
  "Maddalena Ronchi": {
    undergrad_school: "Bocconi University",
    year: 2012,
    major: "Economics and Social Sciences"
  },
  "Roberto Saitto": {
    undergrad_school: "Italian University (unspecified)",
    year: null,
    major: "Economics"
  },
  "Michael Schill": {
    undergrad_school: "Princeton University",
    year: 1980,
    major: "Public Policy"
  },
  "Molly Schnell": {
    undergrad_school: "University of Chicago",
    year: 2011,
    major: "Mathematics, Economics, and Statistics"
  },
  "Bryan Seegmiller": {
    undergrad_school: "Brigham Young University",
    year: 2016,
    major: "Economics and Mathematics"
  },
  "Karen Smilowitz": {
    undergrad_school: "Princeton University",
    year: 1995,
    major: "Civil Engineering and Operations Research"
  },
  "Jacob Teeny": {
    undergrad_school: "Santa Clara University",
    year: 2012,
    major: "Psychology and Philosophy"
  },
  "Artem Timoshenko": {
    undergrad_school: "Lomonosov Moscow State University",
    year: 2013,
    major: "Applied Mathematics and Computer Science"
  },
  "Stephen Vivian": {
    undergrad_school: "University of Illinois at Urbana-Champaign",
    year: null,
    major: "General Engineering"
  },
  "Lulu Wang": {
    undergrad_school: "University of Michigan",
    year: 2016,
    major: "Economics and Mathematics"
  },
  "Nils Wernerfelt": {
    undergrad_school: "Harvard University",
    year: null,
    major: "Mathematics"
  },
  "Regina Wittenberg Moerman": {
    undergrad_school: "Hebrew University of Jerusalem",
    year: 1996,
    major: "Accounting and Economics"
  },
  "Letian Zhang": {
    undergrad_school: "Stanford University",
    year: 2011,
    major: "Mathematics"
  }
};

let updateCount = 0;
let notFoundNames = [];

data.forEach(prof => {
  const update = updates[prof.name];
  if (update) {
    let changed = false;
    if (update.undergrad_school !== null && !prof.undergrad_school) {
      prof.undergrad_school = update.undergrad_school;
      changed = true;
    }
    if (update.year !== null && !prof.year) {
      prof.year = update.year;
      changed = true;
    }
    if (update.major !== null && !prof.major) {
      prof.major = update.major;
      changed = true;
    }
    if (changed) updateCount++;
  } else if (updates.hasOwnProperty(prof.name) === false && (!prof.undergrad_school || !prof.year || !prof.major)) {
    // name not in updates
  }
});

// Special case: "Regina Wittenberg Moerman" vs "Regina Wittenberg-Moerman" - try both
const witNames = ["Regina Wittenberg Moerman", "Regina Wittenberg-Moerman"];
data.forEach(prof => {
  if (witNames.includes(prof.name) && !prof.undergrad_school) {
    const u = updates["Regina Wittenberg Moerman"];
    if (u) {
      if (u.undergrad_school) prof.undergrad_school = u.undergrad_school;
      if (u.year) prof.year = u.year;
      if (u.major) prof.major = u.major;
      updateCount++;
      console.log(`Updated ${prof.name}`);
    }
  }
});

console.log(`Total professors updated: ${updateCount}`);

fs.writeFileSync('kellogg_faculty.json', JSON.stringify(data, null, 2));
console.log('kellogg_faculty.json updated!');

// Print summary of still-null
const stillNull = data.filter(p => !p.undergrad_school);
console.log(`\nStill missing undergrad_school (${stillNull.length}):`);
stillNull.forEach(p => console.log(' -', p.name));
