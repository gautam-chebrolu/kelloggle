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

// ── Daily puzzle settings ──
// Everyone who visits on the same calendar day (in DAILY_TZ) gets the exact
// same professor, derived by seeding a PRNG with the date. The pick is a
// function of the date AND REGULAR_PROFESSORS — i.e. professors.js filtered by
// difficulty. Don't regenerate professors.js or re-label a professor's
// difficulty mid-day, or the puzzle changes underneath players mid-game.
const DAILY_TZ = 'America/Chicago';
const DAILY_EPOCH = '2026-09-12';        // puzzle #1 — the day the daily launched
const LS_DAILY_PREFIX = 'profguess_daily_';  // + YYYY-MM-DD → today's result
// Distinct from BidTrivia's 'bidtrivia-' so the two games' daily picks aren't
// drawn from the same underlying random stream.
const DAILY_SEED_PREFIX = 'profguess-';

const REGULAR_PROFESSORS = PROFESSORS.filter(p => p.difficulty === 'regular');

// ── State ──
let targetProfessor = null;
// 'free' (random professor, all-time board) or 'daily' (seeded, Today board).
let currentMode = 'free';
let currentPuzzleDate = null;    // 'YYYY-MM-DD' in DAILY_TZ — daily mode only
let currentPuzzleNumber = null;  // sequential #, daily mode only
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

/* ═══════════════════════════════════════════════════
   DAILY PUZZLE
   Kept byte-identical to the BidTrivia implementation where possible
   (kellogg-bidtrivia/game.js:352–445) so a fix in one game can be pasted
   straight into the other. Only the storage/seed prefixes differ.
   ═══════════════════════════════════════════════════ */

/**
 * Today's puzzle date as YYYY-MM-DD, always in DAILY_TZ.
 * The fixed timezone is the whole point: if we used the visitor's local clock,
 * players in different zones would be on different puzzles at the same moment.
 */
function getPuzzleDate(d = new Date()) {
  try {
    // 'en-CA' formats as YYYY-MM-DD, which is exactly the key we want.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: DAILY_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  } catch (_) {
    // Intl or the tz database is unavailable — fall back to local date.
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

/** Sequential puzzle number since DAILY_EPOCH — "Daily #47". */
function getPuzzleNumber(puzzleDate = getPuzzleDate()) {
  const toUTC = s => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const days = Math.round((toUTC(puzzleDate) - toUTC(DAILY_EPOCH)) / 86400000);
  return days + 1;
}

/** Deterministic 32-bit seed from an arbitrary string (FNV-1a). */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, well-distributed seeded PRNG. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Daily completion record (localStorage) ── */

function dailyKey(puzzleDate) {
  return LS_DAILY_PREFIX + puzzleDate;
}

/** Today's stored result, or null if they haven't finished today's puzzle. */
function getDailyResult(puzzleDate = getPuzzleDate()) {
  try {
    const raw = localStorage.getItem(dailyKey(puzzleDate));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function saveDailyResult(puzzleDate, result) {
  try {
    localStorage.setItem(dailyKey(puzzleDate), JSON.stringify(result));
  } catch (_) { /* storage full or blocked — the lock just won't stick */ }
}

/** Drop daily records older than 30 days so localStorage doesn't grow forever. */
function pruneDailyResults() {
  try {
    const cutoff = Date.now() - 30 * 86400000;
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LS_DAILY_PREFIX)) continue;
      const datePart = key.slice(LS_DAILY_PREFIX.length);
      const [y, m, d] = datePart.split('-').map(Number);
      if (!y || !m || !d) continue;
      if (Date.UTC(y, m - 1, d) < cutoff) stale.push(key);
    }
    stale.forEach(k => localStorage.removeItem(k));
  } catch (_) { /* non-critical */ }
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

/**
 * A professor forced via ?target=Some%20Name or window.TEST_PROFESSOR_NAME,
 * or null when no override is active. A forced game is never the shared daily
 * puzzle, so callers downgrade it to free play.
 */
function getOverrideProfessor() {
  const params = new URLSearchParams(window.location.search);
  const targetName = params.get('target') || window.TEST_PROFESSOR_NAME;
  if (targetName) {
    const prof = PROFESSORS.find(p => p.name.toLowerCase() === targetName.toLowerCase());
    if (prof) return prof;
  }
  return null;
}

/**
 * Shared reset used by startGame(), startDaily() and playAgain() so the entry
 * points can never drift apart — every new session resets the same state and
 * opens exactly one Firestore document.
 *
 * `mode` is only honoured as 'daily' outside tournament play and with no
 * ?target= override: tournament pages call window.startGame() with no
 * arguments and must never hit the daily lock, and a forced professor isn't
 * the puzzle everyone else is playing.
 */
function beginGame(mode = 'free') {
  const override = getOverrideProfessor();
  const isDaily = mode === 'daily' && !TOURNAMENT_MODE && !override;

  currentMode = isDaily ? 'daily' : 'free';
  currentPuzzleDate = isDaily ? getPuzzleDate() : null;
  currentPuzzleNumber = isDaily ? getPuzzleNumber(currentPuzzleDate) : null;

  targetProfessor = override
    || (isDaily ? pickDailyProfessor(currentPuzzleDate) : pickRandomProfessor());
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

/**
 * Free play by default. tournament.html / tbackup.html monkey-patch
 * window.startGame and call it with no arguments, so the no-arg call must keep
 * meaning "a normal, unlocked game".
 */
function startGame(mode = 'free') {
  beginGame(mode);
}

/** Entry point for the daily button — refuses a second run on the same day. */
function startDaily() {
  if (getDailyResult()) {
    showToast('You already played today — new puzzle at midnight CT.', 'info');
    updateDailyPanel();
    return;
  }
  beginGame('daily');
}

/** The professor everyone playing on `puzzleDate` gets. Pure function of the date. */
function pickDailyProfessor(puzzleDate = getPuzzleDate()) {
  const rng = mulberry32(hashSeed(DAILY_SEED_PREFIX + puzzleDate));
  return REGULAR_PROFESSORS[Math.floor(rng() * REGULAR_PROFESSORS.length)];
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

  const isDaily = currentMode === 'daily';

  if (won) {
    resultEmoji.textContent = '🎉';
    resultTitle.textContent = isDaily ? `Daily #${currentPuzzleNumber} — Solved!` : 'You Got It!';
    resultSub.textContent = `You guessed correctly in ${guessCount} ${guessCount === 1 ? 'try' : 'tries'}!`;
    showToast('🎉 Correct!', 'correct', 1500);
  } else {
    resultEmoji.textContent = '😔';
    resultTitle.textContent = isDaily
      ? `Daily #${currentPuzzleNumber} — Better Luck Tomorrow`
      : 'Better Luck Next Time';
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
  const shareText = buildShareGrid(won);

  // ── Daily lock: record today's result so the puzzle can't be replayed ──
  if (isDaily) {
    saveDailyResult(currentPuzzleDate, {
      puzzleNumber: currentPuzzleNumber,
      won,
      guessesMade: guessCount,
      greenCount,
      elapsedSeconds: gameStartTime
        ? Math.round((Date.now() - gameStartTime.getTime()) / 1000)
        : null,
      professor: targetProfessor.name,
      shareText,
      completedAt: new Date().toISOString(),
    });
    updateDailyPanel();
  }

  // After a daily, "Play Again" can only mean free play — the daily is spent.
  const playAgainBtn = $('play-again-btn');
  if (playAgainBtn) playAgainBtn.textContent = isDaily ? 'Free Play' : 'Play Again';

  resetScoreForm();

  // A daily game lands on the Today board; free play on the all-time board.
  resultLbPeriod = isDaily ? 'today' : 'alltime';
  setActiveTabIn('result-lb-tab-', resultLbPeriod);
  fetchLeaderboard(resultLbPeriod, 'result-leaderboard-list');
  // Refresh again once the completion write lands, so this game can appear.
  updateGameDocument(won).then(ok => {
    if (ok) fetchLeaderboard(resultLbPeriod, 'result-leaderboard-list');
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
    profsGuessed: [],
    mode: currentMode,
    puzzleDate: currentPuzzleDate,   // null for free play
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
  const finalMode = currentMode;
  const finalPuzzleDate = currentPuzzleDate;

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
      profsGuessed: [...guessedNames],
      // Re-stated (not just backfilled) so the document's mode always matches
      // the game that actually finished, even if the create write was lost.
      mode: finalMode,
      puzzleDate: finalPuzzleDate,
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
      profsGuessed: [...guessedNames],
      mode: currentMode,
      puzzleDate: currentPuzzleDate,
      startedAt: gameStartTime || null,
      endedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    await ref.set(payload, { merge: true });
    scoreSubmitted = true;
    status.textContent = 'Saved to the leaderboard!';
    status.className = 'submit-status success';
    fetchLeaderboard(resultLbPeriod, 'result-leaderboard-list');
  } catch (error) {
    console.error('ProfGuess: could not save name', error);
    status.textContent = 'Could not save — please try again.';
    status.className = 'submit-status error';
    button.disabled = false;
    input.disabled = false;
  }
}

/**
 * Rank two finished games: solved before unsolved → fewest guesses → most
 * green tiles → fastest time. Shared by both boards so the Today board and the
 * all-time board never rank the same two games differently.
 */
function compareEntries(a, b) {
  if (a.won !== b.won) return a.won ? -1 : 1;
  if (a.won) {
    if (a.guessesMade !== b.guessesMade) return a.guessesMade - b.guessesMade;
  } else if (a.greenCount !== b.greenCount) {
    return (b.greenCount || 0) - (a.greenCount || 0);
  }
  return (a.elapsedSeconds ?? Infinity) - (b.elapsedSeconds ?? Infinity);
}

/**
 * @param period 'today' — games played on today's daily puzzle
 *               'alltime' — free play (plus legacy rows), all time
 */
async function fetchLeaderboard(period, listId) {
  const list = $(listId);
  if (!list) return;
  if (!db) {
    list.innerHTML = '<p class="leaderboard-empty">Leaderboard unavailable.</p>';
    return;
  }
  try {
    // Both branches use a single equality filter, which Firestore's automatic
    // single-field index covers — stacking two would need a composite index.
    // The other condition is applied client-side below.
    const query = period === 'today'
      ? db.collection(LEADERBOARD_COLLECTION).where('puzzleDate', '==', getPuzzleDate())
      : db.collection(LEADERBOARD_COLLECTION).where('status', '==', 'completed');

    const snapshot = await query.get();
    let entries = snapshot.docs.map(doc => doc.data())
      .filter(entry => entry.status === 'completed')
      .filter(entry => entry.name && typeof entry.guessesMade === 'number');

    if (period === 'today') {
      // The replay lock is client-side only, so someone clearing storage can
      // submit twice. Keep each person's best row so one player can't fill the
      // board — sort first, then take the first row seen per name.
      entries.sort(compareEntries);
      const bestByName = new Map();
      entries.forEach(entry => {
        const key = entry.name.toLowerCase().trim();
        if (!bestByName.has(key)) bestByName.set(key, entry);
      });
      entries = Array.from(bestByName.values());
    } else {
      // Daily results stay off the free-play board: the daily is one fair shot
      // at a shared professor. Legacy documents predate the `mode` field —
      // treat a missing mode as free play so old scores keep showing.
      entries = entries.filter(entry => entry.mode !== 'daily');
    }

    entries.sort(compareEntries);
    renderLeaderboard(entries.slice(0, LEADERBOARD_LIMIT), list, period);
  } catch (error) {
    console.warn('ProfGuess: could not load leaderboard —', error.message);
    list.innerHTML = '<p class="leaderboard-empty">Could not load scores. Please try again shortly.</p>';
  }
}

/* ── Leaderboard tabs ── */

const LB_PERIODS = ['today', 'alltime'];
let startLbPeriod = 'today';
let resultLbPeriod = 'today';

/** Highlight the selected tab in a strip ('start-lb-tab-' or 'result-lb-tab-'). */
function setActiveTabIn(prefix, period) {
  LB_PERIODS.forEach(p => {
    const el = $(prefix + p);
    if (!el) return;
    el.classList.toggle('active', p === period);
    el.setAttribute('aria-selected', String(p === period));
  });
}

function switchStartLeaderboardTab(period) {
  if (period === startLbPeriod) return;
  startLbPeriod = period;
  setActiveTabIn('start-lb-tab-', period);
  fetchLeaderboard(period, 'start-leaderboard-list');
}

function switchResultLeaderboardTab(period) {
  if (period === resultLbPeriod) return;
  resultLbPeriod = period;
  setActiveTabIn('result-lb-tab-', period);
  fetchLeaderboard(period, 'result-leaderboard-list');
}

function renderLeaderboard(entries, list, period = 'alltime') {
  if (!entries.length) {
    const where = period === 'today' ? "on today's puzzle yet" : 'yet';
    list.innerHTML = `<p class="leaderboard-empty">No named games ${where} — be the first!</p>`;
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

/**
 * Build the shareable summary and drop it into the result screen. The puzzle
 * number is what lets people compare a daily in a group chat; an unsolved game
 * scores X/10, Wordle-style.
 */
function buildShareGrid(won) {
  const shareGrid = $('result-share-grid');
  const score = `${won ? guessCount : 'X'}/${MAX_GUESSES}`;
  const header = currentMode === 'daily'
    ? `Kelloggle Daily #${currentPuzzleNumber} — ${score}`
    : `Kelloggle ${score}`;
  let lines = [`${header}\n`];

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

  const text = lines.join('\n');
  shareGrid.textContent = text;
  return text;
}

/** Native share sheet on mobile, clipboard everywhere else. */
function copyText(text) {
  if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
    return navigator.share({ text }).catch(error => {
      if (error && error.name === 'AbortError') return;   // user cancelled
      return writeClipboard(text);
    });
  }
  return writeClipboard(text);
}

function writeClipboard(text) {
  return navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!', 'correct');
  }).catch(() => {
    showToast('Could not copy', 'wrong');
  });
}

function copyShareText() {
  copyText($('result-share-grid').textContent);
}

function playAgain() {
  // After a daily, "Play Again" can only mean free play — the daily is spent.
  beginGame('free');
}

/* ═══════════════════════════════════════════════════
   START SCREEN — DAILY PANEL
   ═══════════════════════════════════════════════════ */

/**
 * Swap the daily button between "play" and "already played today" states.
 * The lock is localStorage-only (same as Wordle) — clearing storage or using a
 * private window gets around it. That's an accepted trade for not needing
 * accounts; the Today board deduplicates by name to blunt the rest.
 */
function updateDailyPanel() {
  if (TOURNAMENT_MODE) return;
  const btn = $('daily-btn');
  const done = $('daily-done');
  if (!btn || !done) return;   // test.html / tournament.html have no mode picker

  const puzzleDate = getPuzzleDate();
  const num = getPuzzleNumber(puzzleDate);
  const result = getDailyResult(puzzleDate);

  const subEl = $('daily-sub');
  if (subEl) subEl.textContent = `#${num} · same professor for everyone`;

  if (!result) {
    btn.style.display = '';
    done.style.display = 'none';
    return;
  }

  btn.style.display = 'none';
  done.style.display = '';
  $('daily-done-num').textContent = `#${result.puzzleNumber ?? num}`;
  $('daily-done-stats').innerHTML = `
    <span><strong>${result.won ? result.guessesMade : 'X'}</strong>/${MAX_GUESSES} guesses</span>
    <span>🟩 ${result.greenCount ?? 0}</span>
    <span>${formatElapsed(result.elapsedSeconds) || '—'}</span>`;
}

/** Re-share today's stored daily result from the start screen. */
function shareStoredDaily() {
  const result = getDailyResult();
  if (!result || !result.shareText) return;
  copyText(result.shareText);
}

document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  pruneDailyResults();
  updateDailyPanel();
  fetchLeaderboard(startLbPeriod, 'start-leaderboard-list');
});
