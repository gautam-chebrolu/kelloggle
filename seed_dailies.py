"""
seed_dailies.py

Populates the profguess_dailies Firestore collection with one document per day
for the next year, using the same seeded PRNG formula from game.js.

Each document is keyed by date (YYYY-MM-DD) and contains:
    { "answer": "Professor Name", "seeded": true }

Documents that already exist are SKIPPED, so re-running is safe and won't
overwrite manual overrides.

Requirements:
    pip install google-cloud-firestore

Usage:
    1. Place a service-account key at ./service-account-key.json
       (Firebase Console → Project Settings → Service accounts → Generate)
    2. python seed_dailies.py
"""

import json
import ctypes
from datetime import date, timedelta
from google.cloud import firestore

# ── Config ──
SERVICE_ACCOUNT_KEY = "./service-account-key.json"
DAILIES_COLLECTION = "profguess_dailies"
DAILY_SEED_PREFIX = "profguess-"
DAYS_TO_SEED = 365


# ── Load professors ──
# professors.js is `const PROFESSORS = [ ... ];` — extract the JSON array.
def load_professors(path="professors.js"):
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()
    # Strip the `const PROFESSORS = ` prefix and trailing `;`
    start = src.index("[")
    end = src.rindex("]") + 1
    profs = json.loads(src[start:end])
    return [p for p in profs if p.get("difficulty") == "regular"]


# ── PRNG helpers (identical to game.js) ──
# These use 32-bit unsigned arithmetic via ctypes to match JS >>> 0 behaviour.

def _u32(n):
    """Coerce to uint32, matching JS `>>> 0`."""
    return ctypes.c_uint32(n).value


def _imul(a, b):
    """Match JS Math.imul — signed 32-bit multiply, then we convert as needed."""
    return ctypes.c_int32(ctypes.c_int32(a).value * ctypes.c_int32(b).value).value


def hash_seed(s):
    """FNV-1a hash — identical to game.js hashSeed()."""
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = _imul(h, 16777619)
    return _u32(h)


def mulberry32(seed):
    """mulberry32 PRNG — identical to game.js mulberry32()."""
    a = _u32(seed)

    def _next():
        nonlocal a
        a = _u32(a + 0x6D2B79F5)
        t = a
        t = _imul(_u32(t ^ _u32(t >> 15)), _u32(t) | 1)
        t = _u32(t)
        t ^= _u32(t + _u32(_imul(_u32(t ^ _u32(t >> 7)), _u32(t) | 61)))
        t = _u32(t)
        return _u32(t ^ _u32(t >> 14)) / 4294967296

    return _next


def pick_daily_professor(date_str, professors):
    rng = mulberry32(hash_seed(DAILY_SEED_PREFIX + date_str))
    idx = int(rng() * len(professors))
    return professors[idx]


# ── Main ──

def main():
    professors = load_professors()
    print(f"Loaded {len(professors)} regular professors\n")

    db = firestore.Client.from_service_account_json(SERVICE_ACCOUNT_KEY)
    collection = db.collection(DAILIES_COLLECTION)

    today = date.today()
    created = 0
    skipped = 0

    batch = db.batch()
    batch_count = 0

    for i in range(DAYS_TO_SEED):
        d = today + timedelta(days=i)
        date_str = d.isoformat()  # YYYY-MM-DD
        prof = pick_daily_professor(date_str, professors)

        doc_ref = collection.document(date_str)

        # Check if it already exists
        if doc_ref.get().exists:
            existing = doc_ref.get().to_dict()
            print(f"  SKIP  {date_str} — already exists (answer: \"{existing.get('answer')}\")")
            skipped += 1
            continue

        batch.set(doc_ref, {"answer": prof["name"], "seeded": True})
        batch_count += 1
        created += 1
        print(f"  SET   {date_str} → {prof['name']}")

        # Firestore batches max out at 500 operations
        if batch_count >= 500:
            batch.commit()
            print(f"  … committed batch of {batch_count}")
            batch = db.batch()
            batch_count = 0

    if batch_count > 0:
        batch.commit()
        print(f"  … committed final batch of {batch_count}")

    print(f"\n✅ Done.  Created: {created}, Skipped: {skipped}")


if __name__ == "__main__":
    main()
