# Gesser Mystery Painting - Complete Testing Guide
## How to Test "Spider Web" Example

---

## Step 1: Upload a Mystery Painting

### Action:
1. Click **🎲 Mystery Topic** button
2. Select a topic (e.g., "Spider Web")
3. Paint your artwork
4. Upload when timer ends

### What to Look For in Console:

```
[Gesser Upload] 🎲 Mystery upload check: {
  mysteryTopic: { topicId: 123, topic: "Spider Web" },
  promptTopic: "Spider Web",
  isMysteryUpload: true,          ← Should be TRUE
  mysteryTopicId: 123
}
```

```
[Gesser Upload] ✅ Server response: {
  isMysteryPaint: true,             ← SERVER MUST RETURN TRUE
  mysteryPaintingId: 456,           ← Unique ID for this mystery
  isSolved: false,                  ← Should be false (nobody guessed yet)
  solverName: null,                 ← Should be null
  totalAttempts: 0                  ← Should be 0
}
```

### ⚠️ CRITICAL: Server Response Requirements

The backend **MUST** return these fields when `isMysteryPaint: true` is sent:

```typescript
{
  isMysteryPaint: true,        // Echo back - confirms it's a mystery
  mysteryPaintingId: number,   // Unique ID for this mystery painting
  isSolved: false,             // Initially false
  solverName: null,            // Initially null
  totalAttempts: 0,            // Initially 0
  // ... other fields (imageUrl, topic, etc.)
}
```

---

## Step 2: View in Gallery

### Action:
Open gallery and find your painting

### What You Should See:

```
┌─────────────────────────────────┐
│ 🎲 _ p i _ _ r   _ e b          │  ← Censored topic!
│                                 │
│ [Your painting image]           │
│                                 │
│ 0 attempts                      │  ← Shows attempt count
└─────────────────────────────────┘
```

**NOT** showing:
- ❌ Full topic "Spider Web"
- ❌ "Mystery Topic" placeholder
- ✅ SHOULD show: "_ p i _ _ r   _ e b" (censored with 2 letters revealed)

### Console Logs to Check:

```
[Gallery] Loading entries...
[Gallery] Found mystery painting: {
  id: 456,
  isMysteryPaint: true,
  mysteryPaintingId: 456,
  topic: "Spider Web",            ← Full topic (for masking)
  isSolved: false,
  totalAttempts: 0
}
```

---

## Step 3: View in Guess Game

### Action:
Click **🔍 Guess Topic** button

### What You Should See:

```
┌─────────────────────────────────┐
│ ✕  🔍 Guess the Topic  👁️ All   │  ← Filter button
├─────────────────────────────────┤
│         1 / 1                   │  ← Counter
├─────────────────────────────────┤
│ [Your painting image]           │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ Guess the Topic:            │ │
│ │ _ p i _ _ r   _ e b         │ │  ← Censored!
│ │ (2 letters revealed)        │ │
│ └─────────────────────────────┘ │
│                                 │
│ ┌──────────────────────────┐   │
│ │ Your guess:              │   │
│ │ [Input field]            │   │
│ └──────────────────────────┘   │
│                                 │
│     [Submit Guess]              │
└─────────────────────────────────┘
```

### Console Logs to Check:

```
[GuessGameScreen] Loading mystery images with filter: all
[GuessGameScreen] ✅ Received response: {
  count: 1,
  filter: "all"
}
```

---

## Step 4: Make a Guess

### Action 1: Wrong Guess
1. Type "Spider Man" (wrong)
2. Click Submit

**Expected Result:**
```
❌ Incorrect! Try again.
Attempts: 1
```

### Action 2: Correct Guess
1. Type "Spider Web" (correct!)
2. Click Submit

**Expected Result:**
```
✅ Correct!
Actual topic: Spider Web
+5 coins earned

[Auto-advance to next image after 2 seconds]
```

### Console Logs:

```
[Gesser] Guess submit: {
  guess: "Spider Web",
  mysteryPaintingId: 456
}

[Gesser] ✅ Guess result: {
  correct: true,
  coinsAwarded: 5,
  message: "Correct! +5 coins"
}
```

---

## Step 5: View Solved Mystery in Gallery

### Action:
Refresh gallery after solving

### What You Should See:

```
┌─────────────────────────────────┐
│ 🎲 _ p i _ _ r   _ e b          │  ← Still censored!
│                                 │
│ [Your painting image]           │
│                                 │
│ ✓ Guessed by @YourName          │  ← Solver info
│ 2 attempts                      │  ← Total attempts
└─────────────────────────────────┘
```

### Server Response After Solve:

The backend should UPDATE the mystery painting record:

```typescript
{
  isMysteryPaint: true,
  mysteryPaintingId: 456,
  isSolved: true,              ← NOW TRUE
  solverName: "YourName",      ← Your display name
  totalAttempts: 2             ← Total attempts made
}
```

---

## Step 6: Filter in Guess Game

### Action:
Click the **👁️ All** / **❓ Unsolved** filter button

### Behavior:
- **👁️ All**: Shows ALL mystery paintings (solved + unsolved)
- **❓ Unsolved**: Shows only unsolved mysteries

### Test:
1. Solve a mystery
2. Toggle filter to "Unsolved"
3. Should not see the solved mystery
4. Toggle to "All"
5. Should see it again (with solved indicator)

---

## Backend API Requirements

### 1. Upload Endpoint

**Request:**
```json
{
  "topic": "Spider Web",
  "isMysteryPaint": true,
  "mysteryTopicId": 123,
  "imageUri": "...",
  ...
}
```

**Response MUST include:**
```json
{
  "isMysteryPaint": true,
  "mysteryPaintingId": 456,
  "isSolved": false,
  "solverName": null,
  "totalAttempts": 0,
  "topic": "Spider Web",
  "imageUrl": "https://..."
}
```

### 2. List Mystery Images Endpoint

**GET** `/api/gesser/list-mystery-images.php?device_id=XXX&filter=all&limit=50`

**Response:**
```json
{
  "ok": true,
  "items": [
    {
      "id": 456,
      "mysteryPaintingId": 456,
      "topic": "Spider Web",
      "imageUrl": "https://...",
      "isSolved": false,
      "solverName": null,
      "totalAttempts": 0,
      "createdAt": "..."
    }
  ],
  "count": 1,
  "filter": "all"
}
```

### 3. Submit Guess Endpoint

**POST** `/api/gesser/submit-guess.php`

**Request:**
```json
{
  "device_id": "XXX",
  "mystery_painting_id": 456,
  "guess": "Spider Web"
}
```

**Response (Correct):**
```json
{
  "ok": true,
  "correct": true,
  "coinsAwarded": 5,
  "message": "Correct! +5 coins",
  "actualTopic": "Spider Web"
}
```

**Response (Incorrect):**
```json
{
  "ok": true,
  "correct": false,
  "coinsAwarded": 0,
  "message": "Incorrect! Try again.",
  "attempts": 1
}
```

---

## Topic Censoring Logic

The app uses deterministic masking based on `mysteryPaintingId`:

**Example: "Spider Web" with ID 123**

1. Extract letters: S, p, i, d, e, r, W, e, b
2. Reveal 2 letters based on ID seed
3. Mask remaining letters with `_`
4. Always show spaces

**Result:** `_ p i _ _ r   _ e b`

**Note:** Same ID = same censored version for all users!

---

## Troubleshooting

### Issue: Gallery shows full topic "Spider Web"

**Cause:** Gallery was showing topic only if `isSolved === true`

**Fix:** ✅ Now shows masked topic for ALL mystery paintings

### Issue: No images in Guess Game

**Possible Causes:**
1. Backend not returning `imageUrl` field
2. Backend filter not working
3. No mystery paintings exist

**Check Console:**
```
[GuessGameScreen] ✅ Received response: { count: 0, filter: "all" }
```

If count is 0, backend has no mystery paintings.

### Issue: Can't see solved mysteries

**Fix:** ✅ Added filter toggle - switch to "👁️ All" mode

### Issue: Mystery topic not using user-submitted topics

**Check Console:**
```
[Gesser] Topic 1 source: user_generated  ← Should be this
[Gesser] Topic 2 source: default_pool    ← NOT always this
```

Backend should prioritize approved user topics!

---

## Expected Full Flow Summary

1. ✅ Upload mystery painting → Server confirms with `isMysteryPaint: true`
2. ✅ View in gallery → Shows censored topic `_ p i _ _ r   _ e b`
3. ✅ View in guess game → Shows image + censored topic
4. ✅ Submit wrong guess → Shows error, increments attempts
5. ✅ Submit correct guess → Awards coins, marks as solved
6. ✅ View in gallery again → Shows "✓ Guessed by @Name" + attempt count
7. ✅ Filter in guess game → Can show all or unsolved only

---

## Client-Side Changes Made

1. **Upload logging** (PaintScreen.tsx:9061-9089)
   - Logs what's being sent to server
   - Logs server response

2. **Gallery censoring** (PaintScreen.tsx:8525)
   - Shows masked topic for ALL mystery paintings
   - No longer checks `isSolved` first

3. **Guess game filter** (GuessGameScreen.tsx:60, 75, 82-99, 208-216)
   - Added "All" / "Unsolved" toggle
   - Loads based on selected filter

4. **Enhanced logging** (PaintScreen.tsx:9283-9293, GuessGameScreen.tsx:82-88)
   - Shows topic sources
   - Shows API responses

---

## Next Steps

1. **Test mystery upload** - Check console logs
2. **Verify server response** - Must include mystery fields
3. **Check gallery** - Should show censored topic
4. **Test guess game** - Should show image + censored topic
5. **Submit guesses** - Test wrong + correct
6. **Verify filter** - Toggle between all/unsolved

---

**All client-side code is ready! Now test and verify the server integration.**
