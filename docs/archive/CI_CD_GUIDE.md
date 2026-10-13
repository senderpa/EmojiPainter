# CI/CD Guide - Continuous Integration & Deployment

## 📚 What is CI/CD?

**CI/CD** is a set of practices that automate software testing and deployment:

### 🔄 Continuous Integration (CI)
Automatically run tests and checks when code changes:
- Developer pushes code to GitHub
- GitHub Actions runs tests automatically
- Tests must pass before merging
- Prevents broken code from reaching main branch

### 🚀 Continuous Deployment (CD)
Automatically build and deploy working code:
- After tests pass
- Automatically build iOS app
- Generate TestFlight builds
- Deploy to App Store

**Benefits:**
- ✅ Catch bugs early
- ✅ Consistent code quality
- ✅ Automated testing
- ✅ Faster releases
- ✅ Less manual work

---

## 🏗️ How It Works (Visual)

```
Developer writes code
    ↓
Push to GitHub
    ↓
GitHub Actions triggered
    ↓
├─ Run TypeScript check
├─ Run ESLint
├─ Run Jest tests
└─ Check code coverage
    ↓
All checks pass?
├─ YES → Can merge to main
└─ NO  → Show errors, block merge
    ↓
(If on main branch)
├─ Build iOS app
├─ Run tests again
├─ Create artifacts
└─ Upload to TestFlight
```

---

## 🛠️ What We Set Up

### GitHub Actions Workflows

#### 1. **Test Workflow** (`.github/workflows/test.yml`)
Runs on every push and pull request

```yaml
Events that trigger:
- Push to main
- Push to develop
- Pull requests to main/develop

Actions:
✓ Install dependencies
✓ Type check (TypeScript)
✓ Lint code (ESLint)
✓ Run tests (Jest)
✓ Upload coverage report
```

#### 2. **Build Workflow** (`.github/workflows/build.yml`)
Runs on main branch pushes (releases)

```yaml
Events that trigger:
- Push to main
- Manual trigger (workflow_dispatch)

Actions:
✓ All tests from test workflow
✓ Build iOS app with Xcode
✓ Create TestFlight archive
✓ Upload build artifacts
```

---

## 📊 Testing in CI

### Unit Tests
```bash
npm test                 # Run all tests
npm run test:watch     # Watch mode (local dev)
npm run test:ci        # CI mode (with coverage)
npm run test:coverage  # Generate coverage report
```

### Test Output
```
PASS  src/__tests__/strokeUtils.test.ts
PASS  src/__tests__/exportUtils.test.ts
PASS  src/__tests__/framerUtils.test.ts
PASS  src/__tests__/cacheUtils.test.ts

Test Suites: 4 passed, 4 total
Tests:       85 passed, 85 total
Snapshots:   0 total
Time:        12.345s
Coverage:    52.3% statements, 48.2% branches
```

---

## 🚦 Workflow Status Checks

### PR Status Checks
When you create a pull request, you'll see:

```
✅ All checks passed
├─ Tests (GitHub Actions)
├─ TypeScript check
├─ ESLint
└─ Coverage report

Ready to merge!
```

or

```
❌ Some checks failed
├─ Tests: 3 failures
│  └─ strokeUtils.test.ts line 45
├─ TypeScript: Type error
│  └─ src/lib/export.ts (5 errors)
└─ Coverage: Below threshold (50%)

Cannot merge until fixed
```

---

## 🔐 Branch Protection Rules

Set up on GitHub to enforce CI/CD:

**Settings → Branches → Branch protection rule:**
- ✅ Require PR reviews before merging
- ✅ Require status checks to pass
  - tests (required)
  - typecheck (required)
  - lint (required)
  - coverage (required)
- ✅ Dismiss stale PR approvals
- ✅ Require branches to be up to date

**Result:**
- No one can merge broken code
- All commits to main are tested
- Guaranteed code quality

---

## 📈 Code Coverage

### What is Coverage?
Percentage of your code that's tested:

```
100% coverage = Every line tested
80% coverage  = 80% of code tested
50% coverage  = Half your code tested
0% coverage   = No tests
```

### Coverage Report
After tests run:

```bash
npm run test:coverage
# Generates: coverage/lcov-report/index.html

Open in browser to see:
- File-by-file breakdown
- Line-by-line coverage
- Coverage gaps highlighted
- Trend over time
```

### Coverage Goals
```
Current: 50.3%
Target:  60%
Goal:    80% (next quarter)
```

---

## 🚀 Deployment Pipeline

### Step 1: Develop & Test Locally
```bash
npm test -- --watch            # Watch mode while coding
npm run typecheck              # Type check
npm run lint                   # Linting
```

### Step 2: Commit & Push
```bash
git add src/
git commit -m "feat: add new feature"
git push origin feature-branch
```

### Step 3: Create Pull Request
- GitHub Actions runs automatically
- All tests must pass
- Code review required
- Approval needed before merge

### Step 4: Merge to Main
- PR approved
- All checks passed
- Click "Merge pull request"

### Step 5: CI/CD Builds Release
- iOS app automatically built
- Tests run again
- Build artifact created
- TestFlight archive uploaded

### Step 6: Manual Deployment (Optional)
Upload TestFlight archive to App Store Connect manually or set up CD for automatic deployment

---

## 🔧 Running Tests Locally

### Before Pushing
Always run tests locally first:

```bash
# Check everything
npm run typecheck      # TypeScript errors?
npm run lint          # Style issues?
npm test              # Tests pass?

# If all pass, push:
git push origin feature-branch
```

### Watch Mode (Development)
```bash
npm run test:watch
# Reruns tests when you change files
# Press 'a' to run all
# Press 'f' to run failed only
# Press 'p' to filter by filename
# Press 'q' to quit
```

### Coverage Report
```bash
npm run test:coverage
open coverage/lcov-report/index.html
# Shows which lines aren't covered
```

---

## 📋 Test File Organization

```
src/
├── __tests__/
│   ├── strokeUtils.test.ts         ✅ Painting core
│   ├── exportUtils.test.ts         ✅ Video export
│   ├── framerUtils.test.ts         ✅ Animation
│   ├── cacheUtils.test.ts          ✅ Gallery cache
│   └── utils.test.ts               ✅ Utilities
│
├── lib/
├── video/
└── framer/
```

### Test Naming Convention
```
describe('Feature Name', () => {
  test('should do something specific', () => {
    // Arrange
    // Act
    // Assert
  });
});
```

---

## 🐛 Debugging Failed Tests

### Step 1: Find the Error
Look at the test output:
```
FAIL  src/__tests__/strokeUtils.test.ts
  ● Stroke Decimation › should reduce points
    expect(received).toBeLessThan(expected)
    Expected: < 5
    Received: 10
```

### Step 2: Run Failing Test Only
```bash
npm test -- strokeUtils.test.ts     # Run specific file
npm test -- --testNamePattern="reduce points"  # Run specific test
```

### Step 3: Debug
```bash
# Add console.log in test
console.log('decimated:', decimated);

# Run with verbose output
npm test -- --verbose

# Watch mode (auto-rerun)
npm run test:watch
```

### Step 4: Fix Code
Fix the implementation and rerun:
```bash
npm test
```

---

## 📊 GitHub Actions Dashboard

View all workflows at: **Actions** tab in GitHub

```
Workflows:
├─ Tests (runs on every push)
│  └─ Latest: ✅ Passed (5 min ago)
│
└─ Build iOS (runs on main)
   └─ Latest: ✅ Passed (10 min ago)
```

Click workflow to see details:
```
Summary
├─ Checkout code: ✅
├─ Setup Node: ✅
├─ Install dependencies: ✅
├─ TypeScript check: ✅
├─ Lint: ✅
├─ Tests: ✅ (85 tests passed)
└─ Upload coverage: ✅
```

---

## 🚨 Common Issues & Fixes

### ❌ Tests Fail Locally
```bash
# Solution: Clean install
rm -rf node_modules package-lock.json
npm install
npm test
```

### ❌ CI Passes but Local Fails
```bash
# Solution: Different Node version
node --version  # Check yours
# Update to 18+
nvm use 18
npm test
```

### ❌ Coverage Below Threshold
```bash
# Current: 40%, Need: 50%
npm run test:coverage
# Open coverage/lcov-report/index.html
# Write tests for uncovered code
npm test -- --coverage
```

### ❌ Type Errors in CI
```bash
npm run typecheck
# Fix TypeScript errors
npm test
```

---

## 🎯 Best Practices

### ✅ DO
- ✅ Run tests locally before pushing
- ✅ Keep tests fast (<5 seconds)
- ✅ Test behavior, not implementation
- ✅ Fix failing tests immediately
- ✅ Review CI/CD failures carefully
- ✅ Keep main branch always working

### ❌ DON'T
- ❌ Push without testing
- ❌ Skip failing tests
- ❌ Ignore coverage gaps
- ❌ Force push to main
- ❌ Skip code reviews
- ❌ Merge broken code

---

## 📈 Monitoring & Stats

### Weekly Report
```
Week of Jan 29:
├─ Total builds: 45
├─ Pass rate: 98.2%
├─ Average test time: 12.3s
├─ Coverage trend: ↑ 52.3% (was 51.1%)
└─ Deployments: 3 (all successful)
```

### Performance Tracking
```
Test execution time:
Week 1: 15s   ← slow
Week 2: 13s
Week 3: 12s   ← optimized
Week 4: 11s   ← fast ✅
```

---

## 🔄 Adding New Tests

When adding a new feature:

1. **Write tests first** (TDD optional)
   ```bash
   npm run test:watch
   ```

2. **Write implementation**
   ```typescript
   // Implementation code
   ```

3. **Run tests locally**
   ```bash
   npm test
   ```

4. **Push to feature branch**
   ```bash
   git push origin feature-name
   ```

5. **CI/CD runs automatically**
   - Tests ✅
   - Type check ✅
   - Lint ✅

6. **Create PR and merge**
   - Code review
   - Approve
   - Merge

---

## 🚀 Next Steps

### Setup GitHub Branch Protection
1. Go to Settings → Branches
2. Add rule for `main` branch
3. Require status checks to pass
4. Require PR reviews

### Setup Codecov Integration (Optional)
1. Go to https://codecov.io
2. Connect GitHub account
3. Enable repo
4. See coverage trends

### Configure Slack Notifications (Optional)
1. Add GitHub to Slack
2. Subscribe to workflow notifications
3. Get alerts on failures

---

## 🎓 Test Commands Reference

```bash
# Development
npm test                    # Run tests once
npm run test:watch        # Watch mode
npm run test:coverage     # Coverage report

# CI/CD
npm run test:ci           # CI mode (strict, coverage)

# Quality checks
npm run typecheck         # TypeScript errors?
npm run lint              # Code style issues?

# Combined
npm run typecheck && npm run lint && npm run test:ci
```

---

## 📞 When Something Goes Wrong

1. **Check GitHub Actions** - Go to Actions tab, see what failed
2. **Read error message** - Shows exactly what's wrong
3. **Run locally** - `npm run test:ci` to reproduce
4. **Fix code** - Make the necessary changes
5. **Push again** - CI/CD retries automatically

---

## Summary

You now have:
✅ **Tests** - Run automatically on every push
✅ **Coverage tracking** - Know what's tested
✅ **Build automation** - Auto-build iOS app on main
✅ **Quality gates** - Prevent broken code merges
✅ **Deployment ready** - One-click releases

**Everything is automated. Your code is always tested and ready!** 🚀
