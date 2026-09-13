/* ═══════════════════════════════════════════════
   ProfGuess — game.js
   Core game logic for the Kellogg professor guessing game
   ═══════════════════════════════════════════════ */

// ── Configuration ──
const MAX_GUESSES = 10;
const CLOSE_THRESHOLD = 3; // years within this range are "close" (yellow)
// Single-player sessions live in their own collection, mirroring BidTrivia's
// split between `bidtrivia` (tournament, keyed by team code) and
// `bidtrivia_leaderboard` (single player, keyed by game start time).
// `profguess` remains the tournament collection — see tournament.html.
const LEADERBOARD_COLLECTION = 'profguess_leaderboard';
const LEADERBOARD_LIMIT = 10;

// tournament.html / tbackup.html set this before loading game.js. In that mode
// the tournament page owns the Firestore record (in the `profguess` collection,
// keyed by team code), so game.js must not also write a leaderboard document.
const TOURNAMENT_MODE = Boolean(window.PROFGUESS_TOURNAMENT_MODE);

const REGULAR_PROFESSORS = PROFESSORS.filter(p => p.difficulty === 'regular');

// ── State ──
let targetProfessor = null;
let guessCount = 0;
let guessedNames = [];
let gameOver = false;
let selectedAutocompleteIndex = -1;
let greenCount = 0;
let db = null;
let gameStartTime = null;
let activeDocRef = null;
// Resolves to true once the start-of-game document is confirmed written.
// Never rejects — a failed create resolves false so callers can recover.
let activeDocReady = Promise.resolve(false);
// Resolves once the end-of-game write has settled, so a fast name submit
// cannot land before (and be overwritten by) the completion payload.
let activeDocFinal = Promise.resolve(false);
let scoreSubmitted = false;

function initFirebase() {
  try {
    if (!window.FIREBASE_CONFIG) {
      console.warn('ProfGuess: firebase-config.js not found — leaderboard disabled.');
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    db = firebase.firestore();
  } catch (error) {
    console.warn('ProfGuess: Firebase initialization failed —', error.message);
  }
}

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

/**
 * Shared reset used by both startGame() and playAgain() so the two entry
 * points can never drift apart — every new session resets the same state and
 * opens exactly one Firestore document.
 */
function beginGame(fallbackFn) {
  targetProfessor = getTargetProfessor(fallbackFn);
  guessCount = 0;
  guessedNames = [];
  gameOver = false;
  greenCount = 0;
  selectedAutocompleteIndex = -1;
  gameStartTime = new Date();
  activeDocRef = null;
  activeDocReady = Promise.resolve(false);
  activeDocFinal = Promise.resolve(false);
  scoreSubmitted = false;
  createGameDocument();

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

function startGame() {
  // First game of the session uses the daily seed.
  beginGame(pickDailyProfessor);
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
  const idx = Math.abs(hash) % REGULAR_PROFESSORS.length;
  return REGULAR_PROFESSORS[idx];
}

function pickRandomProfessor() {
  return REGULAR_PROFESSORS[Math.floor(Math.random() * REGULAR_PROFESSORS.length)];
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

  resetScoreForm();
  fetchLeaderboard('result-leaderboard-list');
  // Refresh again once the completion write lands, so this game can appear.
  updateGameDocument(won).then(ok => {
    if (ok) fetchLeaderboard('result-leaderboard-list');
  });

  showScreen(resultScreen);
}

/* ═══════════════════════════════════════════════════
   FIRESTORE GAME LIFECYCLE
   Three steps, mirroring bidtrivia_leaderboard:
     1. createGameDocument()  — at game start, all fields pre-initialised
     2. updateGameDocument()  — at game end, final score data
     3. handleSubmitScore()   — when the player submits a name
   Every write uses set({ merge: true }) rather than update(), so a step still
   lands even if an earlier step never reached the server. update() throws
   not-found on a missing document, which previously discarded the entire
   end-of-game payload whenever the start-of-game write had failed.
   ═══════════════════════════════════════════════════ */

/** The full field set every session document carries, so start and end writes stay aligned. */
function blankSessionFields() {
  return {
    name: '',
    status: 'in_progress',
    won: null,
    guessesMade: null,
    greenCount: null,
    elapsedSeconds: null,
    targetProfessor: null,
    startedAt: firebase.firestore.FieldValue.serverTimestamp(),
    endedAt: null,
  };
}

/** Stable document id for the current session: the game's start time. */
function sessionDocRef() {
  if (!db) return null;
  const startedAt = gameStartTime || new Date();
  return db.collection(LEADERBOARD_COLLECTION).doc(startedAt.toISOString());
}

async function createGameDocument() {
  // In tournament mode the tournament page owns the record — don't double-write.
  if (TOURNAMENT_MODE || !db || !gameStartTime) return;

  const ref = sessionDocRef();
  // Record the id up front so the end-of-game write targets the same document,
  // but track separately whether the create actually succeeded.
  activeDocRef = ref;
  activeDocReady = ref.set(blankSessionFields())
    .then(() => true)
    .catch(error => {
      console.warn('ProfGuess: could not create game document —', error.message);
      return false;
    });
  return activeDocReady;
}

function updateGameDocument(won) {
  if (TOURNAMENT_MODE || !db) return Promise.resolve(false);

  // Elapsed time is captured now, synchronously, rather than after the create
  // settles — otherwise a slow create would inflate the recorded duration.
  const elapsedSeconds = gameStartTime
    ? Math.round((Date.now() - gameStartTime.getTime()) / 1000)
    : null;
  const finalGuessCount = guessCount;
  const finalGreenCount = greenCount;
  const finalTarget = targetProfessor ? targetProfessor.name : null;

  // Assigned synchronously so a fast name submit always awaits *this* write
  // rather than the previous game's resolved promise.
  activeDocFinal = (async () => {
    // Wait for the create to settle so the two writes can't race, but proceed
    // even if it failed — the merge below creates the document if needed.
    const created = await activeDocReady;
    const ref = activeDocRef || sessionDocRef();
    if (!ref) return false;
    activeDocRef = ref;

    // If the start-of-game write never landed, backfill the fields it would
    // have set so the document is complete rather than partial.
    const payload = {
      ...(created ? {} : { name: '', startedAt: gameStartTime || null }),
      status: 'completed',
      won,
      guessesMade: finalGuessCount,
      greenCount: finalGreenCount,
      elapsedSeconds,
      targetProfessor: finalTarget,
      endedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    try {
      await ref.set(payload, { merge: true });
      return true;
    } catch (error) {
      console.warn('ProfGuess: could not update game document —', error.message);
      return false;
    }
  })();

  return activeDocFinal;
}

function resetScoreForm() {
  const input = $('player-name-input');
  const button = $('submit-score-btn');
  const status = $('submit-status');
  if (!input || !button || !status) return;
  input.value = '';
  input.disabled = false;
  button.disabled = false;
  status.textContent = '';
  status.className = 'submit-status';
}

async function handleSubmitScore() {
  if (scoreSubmitted) return;
  const input = $('player-name-input');
  const button = $('submit-score-btn');
  const status = $('submit-status');
  const name = input.value.trim();
  if (!name) {
    status.textContent = 'Please enter your name first.';
    status.className = 'submit-status error';
    input.focus();
    return;
  }
  if (!db) {
    status.textContent = 'Leaderboard is unavailable for this game.';
    status.className = 'submit-status error';
    return;
  }
  button.disabled = true;
  input.disabled = true;
  status.textContent = 'Saving...';
  status.className = 'submit-status saving';
  try {
    // Let the create and completion writes settle first, so this name isn't
    // clobbered by a completion payload that lands afterwards.
    await activeDocReady;
    const finalized = await activeDocFinal;

    const ref = activeDocRef || sessionDocRef();
    if (!ref) throw new Error('No Firestore reference for this game.');
    activeDocRef = ref;

    // If the earlier writes never landed, write the whole record now so the
    // player's submission isn't lost (mirrors the bidtrivia fallback).
    const payload = finalized ? { name } : {
      name,
      status: 'completed',
      won: targetProfessor ? guessedNames.includes(targetProfessor.name) : null,
      guessesMade: guessCount,
      greenCount,
      elapsedSeconds: gameStartTime
        ? Math.round((Date.now() - gameStartTime.getTime()) / 1000)
        : null,
      targetProfessor: targetProfessor ? targetProfessor.name : null,
      startedAt: gameStartTime || null,
      endedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    await ref.set(payload, { merge: true });
    scoreSubmitted = true;
    status.textContent = 'Saved to the leaderboard!';
    status.className = 'submit-status success';
    fetchLeaderboard('result-leaderboard-list');
  } catch (error) {
    console.error('ProfGuess: could not save name', error);
    status.textContent = 'Could not save — please try again.';
    status.className = 'submit-status error';
    button.disabled = false;
    input.disabled = false;
  }
}

async function fetchLeaderboard(listId) {
  const list = $(listId);
  if (!list) return;
  if (!db) {
    list.innerHTML = '<p class="leaderboard-empty">Leaderboard unavailable.</p>';
    return;
  }
  try {
    // Filter server-side on status (single-field equality — no composite index
    // needed) so in-progress and abandoned sessions aren't downloaded at all.
    const snapshot = await db.collection(LEADERBOARD_COLLECTION)
      .where('status', '==', 'completed')
      .get();
    const entries = snapshot.docs.map(doc => doc.data())
      .filter(entry => entry.name && typeof entry.guessesMade === 'number');
    entries.sort((a, b) => {
      if (a.won !== b.won) return a.won ? -1 : 1;
      if (a.won) {
        if (a.guessesMade !== b.guessesMade) return a.guessesMade - b.guessesMade;
      } else if (a.greenCount !== b.greenCount) {
        return (b.greenCount || 0) - (a.greenCount || 0);
      }
      return (a.elapsedSeconds ?? Infinity) - (b.elapsedSeconds ?? Infinity);
    });
    renderLeaderboard(entries.slice(0, LEADERBOARD_LIMIT), list);
  } catch (error) {
    console.warn('ProfGuess: could not load leaderboard —', error.message);
    list.innerHTML = '<p class="leaderboard-empty">Could not load scores. Please try again shortly.</p>';
  }
}

function renderLeaderboard(entries, list) {
  if (!entries.length) {
    list.innerHTML = '<p class="leaderboard-empty">No named games yet — be the first!</p>';
    return;
  }
  list.innerHTML = entries.map((entry, index) => {
    const result = entry.won ? `${entry.guessesMade} guess${entry.guessesMade === 1 ? '' : 'es'}` : 'No solve';
    const detail = entry.won
      ? formatElapsed(entry.elapsedSeconds)
      : `${entry.greenCount || 0} green tiles`;
    return `<div class="leaderboard-row">
      <span class="leaderboard-rank">${index + 1}</span>
      <span class="leaderboard-name">${escapeHtml(entry.name)}</span>
      <span class="leaderboard-result">${result}<small>${detail}</small></span>
    </div>`;
  }).join('');
}

function formatElapsed(seconds) {
  if (seconds == null) return '';
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return minutes ? `${minutes}m ${remaining}s` : `${remaining}s`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
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
  // Subsequent games pick a new random professor rather than the daily seed.
  beginGame(pickRandomProfessor);
}

document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  fetchLeaderboard('start-leaderboard-list');
});
