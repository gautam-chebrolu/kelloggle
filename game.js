/* ═══════════════════════════════════════════════
   ProfGuess — game.js
   Core game logic for the Kellogg professor guessing game
   ═══════════════════════════════════════════════ */

// ── Configuration ──
const MAX_GUESSES = 10;
const CLOSE_THRESHOLD = 3; // years within this range are "close" (yellow)

// ── State ──
let targetProfessor = null;
let guessCount = 0;
let guessedNames = [];
let gameOver = false;
let selectedAutocompleteIndex = -1;
let greenCount = 0;

// ── Attribute keys (order matters — matches grid columns) ──
const ATTRIBUTES = [
  { key: 'department',          label: 'Department',       type: 'text'  },
  { key: 'tenure',              label: 'Tenure',           type: 'text'  },
  { key: 'highest_degree',      label: 'Highest Degree',   type: 'text'  },
  { key: 'highest_degree_year', label: 'Degree Year',      type: 'year'  },
  { key: 'highest_degree_school',label:'Degree School',    type: 'text'  },
  { key: 'undergrad_year',      label: 'Undergrad Year',   type: 'year'  },
  { key: 'undergrad_school',    label: 'Undergrad School', type: 'text'  },
  { key: 'undergrad_major',     label: 'Undergrad Major',  type: 'text'  },
];

// ── DOM Refs ──
const $ = id => document.getElementById(id);
const startScreen  = $('start-screen');
const gameScreen   = $('game-screen');
const resultScreen = $('result-screen');
const guessCounter = $('guess-counter');
const guessPips    = $('guess-pips');
const profInput    = $('professor-input');
const guessBtn     = $('guess-btn');
const autocomplete = $('autocomplete-list');
const guessesGrid  = $('guesses-grid');
const toastEl      = $('toast');

// ══════════════════════════════════════
//  SCREEN MANAGEMENT
// ══════════════════════════════════════

function showScreen(screen) {
  [startScreen, gameScreen, resultScreen].forEach(s => s.classList.remove('active'));
  screen.classList.add('active');
}

// ══════════════════════════════════════
//  GAME INIT
// ══════════════════════════════════════

function getTargetProfessor(fallbackFn) {
  const params = new URLSearchParams(window.location.search);
  const targetName = params.get('target') || window.TEST_PROFESSOR_NAME;
  if (targetName) {
    const prof = PROFESSORS.find(p => p.name.toLowerCase() === targetName.toLowerCase());
    if (prof) return prof;
  }
  return fallbackFn();
}

function startGame() {
  // Pick a random professor (or use daily seed)
  targetProfessor = getTargetProfessor(pickDailyProfessor);
  guessCount = 0;
  guessedNames = [];
  gameOver = false;
  greenCount = 0;
  selectedAutocompleteIndex = -1;

  // Clear UI
  guessesGrid.innerHTML = '';
  profInput.value = '';
  guessBtn.disabled = true;
  autocomplete.classList.remove('visible');

  // Build guess pips
  renderPips();
  updateCounter();

  showScreen(gameScreen);
  profInput.focus();
}

function pickDailyProfessor() {
  // Use the date as a seed so everyone gets the same professor each day
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % PROFESSORS.length;
  return PROFESSORS[idx];
}

function pickRandomProfessor() {
  return PROFESSORS[Math.floor(Math.random() * PROFESSORS.length)];
}

// ══════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════

function renderPips() {
  guessPips.innerHTML = '';
  for (let i = 0; i < MAX_GUESSES; i++) {
    const pip = document.createElement('div');
    pip.className = 'pip';
    pip.dataset.index = i;
    guessPips.appendChild(pip);
  }
}

function updateCounter() {
  const left = Math.max(0, MAX_GUESSES - guessCount);
  guessCounter.textContent = `Guesses: ${guessCount} | Left: ${left}`;
}

function showToast(message, type = 'info', duration = 2000) {
  toastEl.textContent = message;
  toastEl.className = `toast ${type} show`;
  setTimeout(() => toastEl.classList.remove('show'), duration);
}

// ══════════════════════════════════════
//  AUTOCOMPLETE
// ══════════════════════════════════════

profInput.addEventListener('input', () => {
  const query = profInput.value.trim().toLowerCase();
  guessBtn.disabled = !getExactMatch(profInput.value.trim());
  selectedAutocompleteIndex = -1;

  if (query.length < 1) {
    autocomplete.classList.remove('visible');
    return;
  }

  const matches = PROFESSORS.filter(p => {
    const name = p.name.toLowerCase();
    return name.includes(query) && !guessedNames.includes(p.name);
  }).slice(0, 8);

  if (matches.length === 0) {
    autocomplete.classList.remove('visible');
    return;
  }

  autocomplete.innerHTML = matches.map((p, i) => {
    const name = highlightMatch(p.name, query);
    const dept = p.department === 'MORS' ? 'Management & Organizations' : (p.department || '—');
    return `<div class="autocomplete-item" data-index="${i}" data-name="${p.name}">${name} <span style="color:var(--text-3);font-size:0.75rem;margin-left:0.5rem">${dept}</span></div>`;
  }).join('');

  autocomplete.classList.add('visible');

  // Click handlers
  autocomplete.querySelectorAll('.autocomplete-item').forEach(item => {
    item.addEventListener('click', () => {
      profInput.value = item.dataset.name;
      autocomplete.classList.remove('visible');
      guessBtn.disabled = false;
      profInput.focus();
    });
  });
});

profInput.addEventListener('keydown', (e) => {
  const items = autocomplete.querySelectorAll('.autocomplete-item');
  if (!autocomplete.classList.contains('visible') || items.length === 0) {
    if (e.key === 'Enter' && !guessBtn.disabled) {
      submitGuess();
    }
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedAutocompleteIndex = Math.min(selectedAutocompleteIndex + 1, items.length - 1);
    updateHighlight(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, 0);
    updateHighlight(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (selectedAutocompleteIndex >= 0) {
      items[selectedAutocompleteIndex].click();
    } else if (!guessBtn.disabled) {
      submitGuess();
    }
  } else if (e.key === 'Escape') {
    autocomplete.classList.remove('visible');
  }
});

// Close autocomplete when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.input-section')) {
    autocomplete.classList.remove('visible');
  }
});

function updateHighlight(items) {
  items.forEach((item, i) => {
    item.classList.toggle('highlighted', i === selectedAutocompleteIndex);
  });
  if (selectedAutocompleteIndex >= 0) {
    items[selectedAutocompleteIndex].scrollIntoView({ block: 'nearest' });
  }
}

function highlightMatch(name, query) {
  const idx = name.toLowerCase().indexOf(query);
  if (idx === -1) return name;
  return name.slice(0, idx) + 
    `<span class="match-highlight">${name.slice(idx, idx + query.length)}</span>` + 
    name.slice(idx + query.length);
}

function getExactMatch(input) {
  return PROFESSORS.find(p => p.name.toLowerCase() === input.toLowerCase());
}

// ══════════════════════════════════════
//  GUESS LOGIC
// ══════════════════════════════════════

function submitGuess() {
  if (gameOver) return;

  const input = profInput.value.trim();
  const guessed = getExactMatch(input);

  if (!guessed) {
    showToast('Please select a valid professor', 'wrong');
    profInput.parentElement.classList.add('shake');
    setTimeout(() => profInput.parentElement.classList.remove('shake'), 400);
    return;
  }

  if (guessedNames.includes(guessed.name)) {
    showToast('Already guessed!', 'wrong');
    return;
  }

  guessedNames.push(guessed.name);
  guessCount++;

  // Build the guess row
  const row = buildGuessRow(guessed);
  guessesGrid.appendChild(row);

  // Update pips
  const pip = guessPips.children[guessCount - 1];
  if (guessed.name === targetProfessor.name) {
    pip.classList.add('correct');
  } else {
    pip.classList.add('used');
  }

  updateCounter();

  // Clear input
  profInput.value = '';
  guessBtn.disabled = true;
  autocomplete.classList.remove('visible');

  // Check win/lose
  if (guessed.name === targetProfessor.name) {
    gameOver = true;
    setTimeout(() => endGame(true), 1200);
  } else if (guessCount >= MAX_GUESSES) {
    gameOver = true;
    setTimeout(() => endGame(false), 1200);
  } else {
    profInput.focus();
  }
}

function buildGuessRow(guessed) {
  const row = document.createElement('div');
  row.className = 'guess-row';

  // Image tile
  const imgTile = document.createElement('div');
  imgTile.className = 'tile tile-image';
  if (guessed.image) {
    imgTile.innerHTML = `<img src="${guessed.image}" alt="${guessed.name}">`;
  } else {
    imgTile.innerHTML = `<span class="no-image">No Pic</span>`;
  }
  row.appendChild(imgTile);

  // Name tile
  const nameTile = document.createElement('div');
  nameTile.className = 'tile tile-name';
  if (guessed.name === targetProfessor.name) {
    nameTile.classList.add('correct');
  }
  nameTile.innerHTML = `<span class="tile-value">${guessed.name}</span>`;
  row.appendChild(nameTile);

  // Attribute tiles
  ATTRIBUTES.forEach((attr, i) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.style.animationDelay = `${(i + 2) * 80}ms`;

    const guessedVal = guessed[attr.key];
    const targetVal  = targetProfessor[attr.key];
    let state = 'wrong';
    let arrow = '';

    if (attr.type === 'year') {
      const gYear = parseInt(guessedVal);
      const tYear = parseInt(targetVal);

      if (!isNaN(gYear) && !isNaN(tYear)) {
        if (gYear === tYear) {
          state = 'correct';
          greenCount++;
        } else if (Math.abs(gYear - tYear) <= CLOSE_THRESHOLD) {
          state = 'close';
          arrow = gYear < tYear ? '↑ Higher' : '↓ Lower';
        } else {
          state = 'wrong';
          arrow = gYear < tYear ? '↑ Higher' : '↓ Lower';
        }
      } else if (String(guessedVal).toLowerCase() === String(targetVal).toLowerCase()) {
        state = 'correct';
        greenCount++;
      }
    } else {
      // Text comparison (case-insensitive)
      if (String(guessedVal).toLowerCase() === String(targetVal).toLowerCase()) {
        state = 'correct';
        greenCount++;
      }
    }

    let displayVal = guessedVal;
    if (attr.key === 'department' && displayVal === 'MORS') {
      displayVal = 'Management & Organizations';
    }

    tile.classList.add(state);
    tile.innerHTML = `
      <span class="tile-value">${displayVal || '—'}</span>
      ${arrow ? `<span class="tile-arrow">${arrow}</span>` : ''}
    `;

    row.appendChild(tile);
  });

  return row;
}

// ══════════════════════════════════════
//  END GAME
// ══════════════════════════════════════

function endGame(won) {
  const resultEmoji = $('result-emoji');
  const resultTitle = $('result-title');
  const resultSub   = $('result-sub');
  const resultName  = $('result-name');
  const resultDept  = $('result-dept');
  const resultDetail= $('result-detail');
  const resultGuesses=$('result-guesses');
  const resultGreens= $('result-greens');

  if (won) {
    resultEmoji.textContent = '🎉';
    resultTitle.textContent = 'You Got It!';
    resultSub.textContent = `You guessed correctly in ${guessCount} ${guessCount === 1 ? 'try' : 'tries'}!`;
    showToast('🎉 Correct!', 'correct', 1500);
  } else {
    resultEmoji.textContent = '😔';
    resultTitle.textContent = 'Better Luck Next Time';
    resultSub.textContent = `The answer was ${targetProfessor.name}`;
  }

  resultName.textContent = targetProfessor.name;
  resultDept.textContent = targetProfessor.department === 'MORS' ? 'Management & Organizations' : (targetProfessor.department || '—');

  const details = [];
  if (targetProfessor.tenure) details.push(`Tenure: ${targetProfessor.tenure}`);
  if (targetProfessor.highest_degree) {
    const school = targetProfessor.highest_degree_school || '—';
    const year = targetProfessor.highest_degree_year || '—';
    details.push(`${targetProfessor.highest_degree} (${school}, ${year})`);
  }
  if (targetProfessor.undergrad_school || targetProfessor.undergrad_major || targetProfessor.undergrad_year) {
    const ugSchool = targetProfessor.undergrad_school || '—';
    const ugMajor = targetProfessor.undergrad_major || '—';
    const ugYear = targetProfessor.undergrad_year || '—';
    details.push(`Undergrad: ${ugSchool} — ${ugMajor} (${ugYear})`);
  }
  resultDetail.innerHTML = details.join('<br>');

  resultGuesses.textContent = guessCount;
  resultGreens.textContent = greenCount;

  // Build share grid
  buildShareGrid();

  showScreen(resultScreen);
}

function buildShareGrid() {
  const shareGrid = $('result-share-grid');
  let lines = [`ProfGuess ${guessCount}/${MAX_GUESSES}\n`];
  
  const rows = guessesGrid.querySelectorAll('.guess-row');
  rows.forEach(row => {
    let line = '';
    const tiles = row.querySelectorAll('.tile:not(.tile-name)');
    tiles.forEach(tile => {
      if (tile.classList.contains('correct')) line += '🟩';
      else if (tile.classList.contains('close')) line += '🟨';
      else line += '⬜';
    });
    lines.push(line);
  });

  shareGrid.textContent = lines.join('\n');
}

function copyShareText() {
  const shareGrid = $('result-share-grid');
  navigator.clipboard.writeText(shareGrid.textContent).then(() => {
    showToast('Copied to clipboard!', 'correct');
  }).catch(() => {
    showToast('Could not copy', 'wrong');
  });
}

function playAgain() {
  // Pick a new random professor (not daily this time, unless overridden)
  targetProfessor = getTargetProfessor(pickRandomProfessor);
  guessCount = 0;
  guessedNames = [];
  gameOver = false;
  greenCount = 0;
  selectedAutocompleteIndex = -1;

  guessesGrid.innerHTML = '';
  profInput.value = '';
  guessBtn.disabled = true;
  autocomplete.classList.remove('visible');

  renderPips();
  updateCounter();
  showScreen(gameScreen);
  profInput.focus();
}
