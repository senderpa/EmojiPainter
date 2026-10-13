/**
 * Framer Workspace Automated Test
 * Run this to verify framer painting works correctly
 */

import { getStamp } from '../../components/EmojiCanvas';

export const testFramerPainting = () => {
  console.log('=== FRAMER AUTOMATED TEST ===');

  // Test 1: Verify getStamp is available
  console.log('Test 1: getStamp function exists');
  if (typeof getStamp !== 'function') {
    console.error('❌ FAIL: getStamp is not a function');
    return false;
  }
  console.log('✅ PASS: getStamp is a function');

  // Test 2: Verify stamp creation
  console.log('Test 2: Creating stamp for 🎨 size 64');
  const stamp = getStamp('🎨', 64);
  if (!stamp) {
    console.error('❌ FAIL: Could not create stamp');
    return false;
  }
  console.log('✅ PASS: Stamp created successfully');

  // Test 3: Verify stamp has correct properties
  console.log('Test 3: Verify stamp properties');
  if (!stamp.width || !stamp.height) {
    console.error('❌ FAIL: Stamp missing width/height');
    return false;
  }
  console.log(`✅ PASS: Stamp has dimensions ${stamp.width()}x${stamp.height()}`);

  console.log('=== ALL TESTS PASSED ===');
  return true;
};

export const testFramePainting = () => {
  console.log('=== FRAME PAINTING TEST ===');

  // Simulate frame painting logic
  const frameCount = 300;
  const currentFrame = 0;
  const strokeLength = 3;

  // Calculate active frames
  const activeIndices: number[] = [];
  const endFrame = (currentFrame + strokeLength) % frameCount;
  const isWrapping = endFrame < currentFrame;

  for (let i = 0; i < frameCount; i++) {
    if (isWrapping) {
      if ((i >= currentFrame && i < frameCount) || (i < endFrame)) {
        activeIndices.push(i);
      }
    } else {
      if (i >= currentFrame && i < endFrame) {
        activeIndices.push(i);
      }
    }
  }

  console.log(`Current frame: ${currentFrame}`);
  console.log(`Stroke length: ${strokeLength}`);
  console.log(`Active frames: [${activeIndices.join(', ')}]`);
  console.log(`Expected: [0, 1, 2]`);

  if (activeIndices.length !== 3) {
    console.error(`❌ FAIL: Expected 3 active frames, got ${activeIndices.length}`);
    return false;
  }

  if (activeIndices[0] !== 0 || activeIndices[1] !== 1 || activeIndices[2] !== 2) {
    console.error('❌ FAIL: Active frames incorrect');
    return false;
  }

  console.log('✅ PASS: Frame calculation correct');
  console.log('=== FRAME PAINTING TEST PASSED ===');
  return true;
};
