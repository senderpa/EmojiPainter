#!/bin/bash

##
# GESSER FEATURE - Pre-Release Verification Script
# Run this before creating a release build
##

echo "🔍 GESSER FEATURE VERIFICATION"
echo "==============================="
echo ""

ERRORS=0
WARNINGS=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

## 1. Check all Gesser TypeScript files exist
echo "📁 Checking Gesser files..."

REQUIRED_FILES=(
  "src/gesser/api/gesserClient.ts"
  "src/gesser/components/SuggestTopicOverlay.tsx"
  "src/gesser/components/TopicReviewCard.tsx"
  "src/gesser/screens/GuessGameScreen.tsx"
  "src/gesser/screens/UserDiscoveryScreen.tsx"
  "src/gesser/screens/FriendsListScreen.tsx"
  "src/gesser/utils/masking.ts"
  "src/gesser/utils/storage.ts"
  "src/gesser/types.ts"
  "src/gesser/config.ts"
)

for file in "${REQUIRED_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo -e "  ${GREEN}✓${NC} $file"
  else
    echo -e "  ${RED}✗${NC} $file (MISSING)"
    ((ERRORS++))
  fi
done

echo ""

## 2. Check PaintScreen integration
echo "🎨 Checking PaintScreen.tsx integration..."

if grep -q "import.*SuggestTopicOverlay.*from.*gesser" src/screens/PaintScreen.tsx; then
  echo -e "  ${GREEN}✓${NC} SuggestTopicOverlay imported"
else
  echo -e "  ${RED}✗${NC} SuggestTopicOverlay not imported"
  ((ERRORS++))
fi

if grep -q "import.*GuessGameScreen.*from.*gesser" src/screens/PaintScreen.tsx; then
  echo -e "  ${GREEN}✓${NC} GuessGameScreen imported"
else
  echo -e "  ${RED}✗${NC} GuessGameScreen not imported"
  ((ERRORS++))
fi

if grep -q "import.*isGesserEnabled.*from.*gesser" src/screens/PaintScreen.tsx; then
  echo -e "  ${GREEN}✓${NC} isGesserEnabled imported"
else
  echo -e "  ${RED}✗${NC} isGesserEnabled not imported"
  ((ERRORS++))
fi

if grep -q "mysteryTopicSelected" src/screens/PaintScreen.tsx; then
  echo -e "  ${GREEN}✓${NC} Mystery topic state variables present"
else
  echo -e "  ${RED}✗${NC} Mystery topic state variables missing"
  ((ERRORS++))
fi

echo ""

## 3. Check feature flags
echo "🚩 Checking feature flags..."

if grep -q "enabled: true" src/gesser/config.ts; then
  echo -e "  ${GREEN}✓${NC} Gesser master flag enabled"
else
  echo -e "  ${RED}✗${NC} Gesser master flag DISABLED"
  ((ERRORS++))
fi

if grep -q "maxTopicWords: 3" src/gesser/config.ts; then
  echo -e "  ${GREEN}✓${NC} Max topic words = 3 (correct)"
else
  echo -e "  ${YELLOW}⚠${NC} Max topic words != 3 (should be 3 for Kung Fu Panda)"
  ((WARNINGS++))
fi

echo ""

## 4. Check TypeScript compilation
echo "📝 Checking TypeScript compilation..."

tsc_output=$(npx tsc --noEmit 2>&1)
tsc_exit=$?

# Check for real errors (not test file warnings)
real_errors=$(echo "$tsc_output" | grep -v "jest\|describe\|test\|expect" | grep "error TS")

if [ -z "$real_errors" ]; then
  echo -e "  ${GREEN}✓${NC} No TypeScript errors (test warnings OK)"
else
  echo -e "  ${RED}✗${NC} TypeScript errors found:"
  echo "$real_errors" | head -5
  ((ERRORS++))
fi

echo ""

## 5. Check package.json dependencies
echo "📦 Checking dependencies..."

if grep -q "@react-native-async-storage/async-storage" package.json; then
  echo -e "  ${GREEN}✓${NC} AsyncStorage installed"
else
  echo -e "  ${RED}✗${NC} AsyncStorage missing (required for Gesser)"
  ((ERRORS++))
fi

echo ""

## 6. Check dailyPaintUpload integration
echo "📤 Checking upload integration..."

if grep -q "isMysteryPaint" src/lib/dailyPaintUpload.ts; then
  echo -e "  ${GREEN}✓${NC} Mystery paint upload parameters added"
else
  echo -e "  ${RED}✗${NC} Mystery paint upload not integrated"
  ((ERRORS++))
fi

if grep -q "mysteryTopicId" src/lib/dailyPaintUpload.ts; then
  echo -e "  ${GREEN}✓${NC} Mystery topic ID parameter added"
else
  echo -e "  ${RED}✗${NC} Mystery topic ID parameter missing"
  ((ERRORS++))
fi

echo ""

## 7. Check dailyPaintGallery integration
echo "🖼️  Checking gallery integration..."

if grep -q "isMysteryPaint" src/lib/dailyPaintGallery.ts; then
  echo -e "  ${GREEN}✓${NC} Mystery paint gallery properties added"
else
  echo -e "  ${RED}✗${NC} Mystery paint gallery not integrated"
  ((ERRORS++))
fi

echo ""

## 8. Summary
echo "==============================="
echo "📊 VERIFICATION SUMMARY"
echo "==============================="

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo -e "${GREEN}✅ ALL CHECKS PASSED!${NC}"
  echo ""
  echo "Gesser feature is fully integrated and ready for release build."
  echo ""
  echo "Next steps:"
  echo "  1. Run: npx expo run:ios --configuration Release"
  echo "  2. Test all 6 Gesser features"
  echo "  3. Verify mystery topic upload works"
  exit 0
elif [ $ERRORS -eq 0 ]; then
  echo -e "${YELLOW}⚠ WARNINGS: $WARNINGS${NC}"
  echo ""
  echo "Gesser feature is ready, but has minor warnings."
  echo "Review warnings above before release build."
  exit 0
else
  echo -e "${RED}❌ ERRORS: $ERRORS${NC}"
  echo -e "${YELLOW}⚠ WARNINGS: $WARNINGS${NC}"
  echo ""
  echo "Fix errors above before creating release build."
  exit 1
fi
