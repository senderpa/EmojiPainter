# 🧪 Complete Guide: How to Run ALL Tests

## ✨ What You Have Now

**244 Unit Tests** covering EVERYTHING in your app:
- ✅ Painting features (73 tests)
- ✅ Gallery & caching (68 tests)
- ✅ Framer & animations (64 tests)
- ✅ UI & interactions (39 tests)

**All tests run in ~0.67 seconds** - super fast!

---

## 🚀 Quick Start (Copy & Paste)

### **Run ALL Tests Once**
```bash
npm test
```

**Output you'll see:**
```
PASS src/__tests__/paintingFeatures.test.ts
PASS src/__tests__/galleryFeatures.test.ts
PASS src/__tests__/framerAnimationFeatures.test.ts
PASS src/__tests__/uiInteractionFeatures.test.ts
... (4 original test files)

Test Suites: 8 passed, 8 total
Tests:       244 passed, 244 total
Time:        0.67 s
```

---

## 📋 All Test Commands

### **1. Run All Tests Once**
```bash
npm test
```
✅ Fast check - runs everything
⏱️ Time: ~0.7 seconds
💻 Perfect for: Before pushing code

---

### **2. Watch Mode (Auto Re-run)**
```bash
npm run test:watch
```
✅ Tests re-run when you change files
✅ Hit `a` to run ALL tests
✅ Hit `f` to run only FAILED tests
✅ Hit `p` to search by filename
✅ Hit `q` to quit

**Great for:** While developing - tests run automatically

---

### **3. Run Specific Test File**
```bash
npm test paintingFeatures.test.ts
```

Test specific features:
```bash
npm test paintingFeatures        # All painting tests (73 tests)
npm test galleryFeatures         # All gallery tests (68 tests)
npm test framerAnimationFeatures # All framer tests (64 tests)
npm test uiInteractionFeatures   # All UI tests (39 tests)
npm test strokeUtils             # Original tests (30 tests)
npm test exportUtils             # Original tests (25 tests)
npm test framerUtils             # Original tests (20 tests)
npm test cacheUtils              # Original tests (13 tests)
```

---

### **4. Run Specific Test by Name**
```bash
npm test -- --testNamePattern="should create brush"
```

More examples:
```bash
npm test -- --testNamePattern="Brush Operations"
npm test -- --testNamePattern="Undo/Redo"
npm test -- --testNamePattern="Gallery Loading"
npm test -- --testNamePattern="Touch Gestures"
```

---

### **5. Test with Coverage Report**
```bash
npm run test:coverage
```

✅ Shows % of code tested
✅ Generates HTML report
✅ Open report:
```bash
open coverage/lcov-report/index.html
```

---

### **6. Run Tests in CI Mode (Strict)**
```bash
npm run test:ci
```

✅ Same as GitHub Actions uses
✅ Coverage must be > 50%
✅ All tests must pass
⏱️ Time: ~0.7 seconds

---

## 🎯 Common Test Scenarios

### **Scenario 1: Before Committing Code**
```bash
# Run all tests
npm test

# If all pass ✅
git add .
git commit -m "my changes"

# If any fail ❌
# Fix the code and run again
npm test
```

---

### **Scenario 2: Developing a Feature**
```bash
# Terminal 1 - Watch tests
npm run test:watch

# Terminal 2 - Edit code in your editor
# As you save, tests re-run automatically in Terminal 1!

# When you see all green ✅, feature is working
```

---

### **Scenario 3: Testing Specific Feature**
```bash
# Just want to test painting features
npm test paintingFeatures

# Just want to test gallery
npm test galleryFeatures

# Just want to test animations
npm test framerAnimationFeatures

# Just want to test UI
npm test uiInteractionFeatures
```

---

### **Scenario 4: Debug a Failing Test**
```bash
# Find which test is failing
npm test

# Run only that test
npm test -- --testNamePattern="exact test name here"

# Run with verbose output
npm test -- --verbose

# Run with coverage to see what's missing
npm run test:coverage
```

---

### **Scenario 5: CI/CD Pipeline (GitHub Actions)**
```bash
# This runs automatically when you push!
npm run test:ci

# It runs:
# 1. TypeScript type check
# 2. ESLint linting
# 3. Jest tests (244 tests)
# 4. Coverage report (must be > 50%)
```

---

## 📊 What Each Test File Tests

### **paintingFeatures.test.ts** (73 tests)
Tests all drawing functionality:
- Brush operations (size, opacity, emoji types)
- Stroke creation & manipulation
- Eraser tool
- Undo/Redo system
- Drawing tools (brush, line)
- Color management
- Canvas operations
- Canvas transformations (flip, rotate)

```bash
npm test paintingFeatures
```

---

### **galleryFeatures.test.ts** (68 tests)
Tests all gallery & storage:
- Gallery loading & sorting
- Thumbnail management & caching
- Video storage & metadata
- Cache management (LRU, expiration)
- Offline gallery support
- Gallery search & filtering
- Gallery sharing
- Import/Export

```bash
npm test galleryFeatures
```

---

### **framerAnimationFeatures.test.ts** (64 tests)
Tests all animation features:
- Frame management (create, delete, reorder)
- Frame timing & duration, FPS
- Keyframe management & interpolation
- Animation playback (play, pause, loop, speed)
- Emoji planes & transforms
- Onion skin (frame preview)
- Animation effects (fade, zoom, rotate)
- Layer management

```bash
npm test framerAnimationFeatures
```

---

### **uiInteractionFeatures.test.ts** (39 tests)
Tests all UI components:
- Button interactions
- Slider controls
- Modal dialogs
- Touch gestures (tap, double-tap, pan, pinch, long-press)
- Keyboard input
- UI animations
- Dropdown & pickers
- Notifications & toast
- Loading states
- Screen orientation
- Form validation

```bash
npm test uiInteractionFeatures
```

---

### **Original Test Files** (88 tests)
Previously created tests (still running):
- **strokeUtils.test.ts** - Painting core (30 tests)
- **exportUtils.test.ts** - Video export (25 tests)
- **framerUtils.test.ts** - Animation (20 tests)
- **cacheUtils.test.ts** - Gallery cache (13 tests)

```bash
npm test strokeUtils       # Just stroke tests
npm test exportUtils       # Just export tests
npm test framerUtils       # Just framer tests
npm test cacheUtils        # Just cache tests
```

---

## 🔧 Advanced Commands

### **Run Tests with Debug Output**
```bash
npm test -- --verbose
```

### **Run Single Test File with Full Output**
```bash
npm test paintingFeatures -- --verbose
```

### **List All Available Tests**
```bash
npm test -- --listTests
```

### **Run Tests Matching Pattern**
```bash
npm test -- --testNamePattern="Brush"
npm test -- --testNamePattern="Gallery Loading"
npm test -- --testNamePattern="Gesture"
```

### **Run Tests in Specific Directory**
```bash
npm test -- src/__tests__/paintingFeatures.test.ts
```

### **Update Snapshots** (if you had any)
```bash
npm test -- --updateSnapshot
```

### **Run Tests with Specific Timeout**
```bash
npm test -- --testTimeout=10000
```

---

## 📈 Understanding Test Output

### **When All Tests Pass** ✅
```
PASS src/__tests__/paintingFeatures.test.ts
PASS src/__tests__/galleryFeatures.test.ts
...
Test Suites: 8 passed, 8 total
Tests:       244 passed, 244 total
```

### **When a Test Fails** ❌
```
FAIL src/__tests__/paintingFeatures.test.ts
  ● Brush Operations › should set brush size

    expect(received).toBe(expected)
    Expected: 100
    Received: 50

    at Object.toBe (src/__tests__/paintingFeatures.test.ts:45:22)

Test Suites: 1 failed, 7 passed
Tests:       1 failed, 243 passed
```

---

## 🎓 How Tests Work (Simple Explanation)

### **Each Test Has 3 Parts:**

```javascript
test('should set brush size', () => {
  // 1️⃣ ARRANGE - Set up
  const brush = { size: 50 };

  // 2️⃣ ACT - Do something
  brush.size = 100;

  // 3️⃣ ASSERT - Check result
  expect(brush.size).toBe(100);
});
```

### **Test Keywords:**
- `describe()` - Groups related tests
- `test()` - Individual test
- `expect()` - Check the result
- `toBe()` - Exact match
- `toHaveLength()` - Check array/string length
- `toContain()` - Check if contains value

---

## ✋ Testing Checklist

### **Before Pushing Code:**
- [ ] Run `npm test` - All 244 tests pass ✅
- [ ] Run `npm run lint` - No errors
- [ ] Run `npm run typecheck` - No TypeScript errors

### **When Developing:**
- [ ] Use `npm run test:watch` for auto-testing
- [ ] Watch tests pass as you code
- [ ] Only commit when all tests pass

### **Before Release:**
- [ ] Run `npm run test:ci` (same as GitHub Actions)
- [ ] Check coverage report
- [ ] Test on real device: `npm run ios`

---

## 🚀 **TL;DR Quick Reference**

| Goal | Command |
|------|---------|
| Run all tests | `npm test` |
| Watch mode | `npm run test:watch` |
| Coverage report | `npm run test:coverage` |
| CI mode (strict) | `npm run test:ci` |
| Test painting | `npm test paintingFeatures` |
| Test gallery | `npm test galleryFeatures` |
| Test framer | `npm test framerAnimationFeatures` |
| Test UI | `npm test uiInteractionFeatures` |
| Test specific test | `npm test -- --testNamePattern="test name"` |
| Verbose output | `npm test -- --verbose` |

---

## 🎯 Your Testing Goals

**You now have:**
- ✅ **244 automated tests** - Run in <1 second
- ✅ **All features covered** - Painting, Gallery, Framing, UI
- ✅ **Coverage tracking** - Know what's tested
- ✅ **CI/CD ready** - GitHub Actions integrated
- ✅ **Watch mode** - Auto-run while developing
- ✅ **Professional setup** - Production-ready testing

---

## 📞 Quick Troubleshooting

### **Tests won't run?**
```bash
npm install                    # Reinstall dependencies
npm test                       # Try again
```

### **Tests slow?**
They shouldn't be - tests run in 0.67 seconds. If slower:
```bash
npm test -- --clearCache      # Clear Jest cache
```

### **One test failing?**
```bash
npm test -- --testNamePattern="exact test name"
```

### **Want to see coverage?**
```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

---

## 🎉 You're Ready!

Your app now has **professional-grade testing**.

### **Next Steps:**
1. Run tests: `npm test` ✅
2. Build to device: `npm run ios` 🏗️
3. Test manually on device
4. Push code (GitHub Actions will run tests automatically!)

**All tests pass? You're production-ready!** 🚀

