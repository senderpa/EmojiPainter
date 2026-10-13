/**
 * Script to remove all light layer feature code from FramerWorkspace.tsx
 * This removes: types, state, logic, UI, and all references
 */

const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'src/framer/FramerWorkspace.tsx');
const BACKUP_PATH = path.join(__dirname, 'src/framer/FramerWorkspace.tsx.backup');

// Read the file
let content = fs.readFileSync(FILE_PATH, 'utf8');
const originalLines = content.split('\n').length;
const originalSize = content.length;

console.log(`📄 Original file: ${originalLines} lines, ${originalSize} bytes`);

// Create backup
fs.writeFileSync(BACKUP_PATH, content);
console.log(`💾 Backup created: ${BACKUP_PATH}`);

let removedSections = [];

// 1. Remove LightLayerStroke interface (lines ~95-105)
const lightLayerStrokePattern = /\/\/ Light layer \(foreground layer\) stroke interface\s*\n\s*interface LightLayerStroke \{[^}]*\}/s;
if (lightLayerStrokePattern.test(content)) {
  content = content.replace(lightLayerStrokePattern, '');
  removedSections.push('LightLayerStroke interface');
}

// 2. Remove LightLayerKeyframe interface (lines ~107-116)
const lightLayerKeyframePattern = /\/\/ Light layer animation keyframe[^}]+\ninterface LightLayerKeyframe \{[^}]*\}/s;
if (lightLayerKeyframePattern.test(content)) {
  content = content.replace(lightLayerKeyframePattern, '');
  removedSections.push('LightLayerKeyframe interface');
}

// 3. Remove LightLayerRecording interface (lines ~155-161)
const lightLayerRecordingPattern = /\/\/ Light layer recording[^}]+\ninterface LightLayerRecording \{[^}]*\}/s;
if (lightLayerRecordingPattern.test(content)) {
  content = content.replace(lightLayerRecordingPattern, '');
  removedSections.push('LightLayerRecording interface');
}

// 4. Remove light layer fields from FramerStateData interface
content = content.replace(/\s*\/\/ Light layer \(foreground layer\) data\s*\n\s*lightLayerStrokes: LightLayerStroke\[\];\s*\n\s*lightLayerRecordings: LightLayerRecording\[\];\s*\n\s*activeLightRecordingId: string \| null;\s*/g, '');
removedSections.push('Light layer fields from FramerStateData');

// 5. Remove all useState declarations for light layer
const stateVarsToRemove = [
  'lightLayerActive',
  'lightLayerStrokes',
  'lightLayerRecordings',
  'activeLightRecordingId',
  'lightLayerAlpha',
  'lightLayerBrightness',
  'lightLayerScale',
  'lightLayerOffsetX',
  'lightLayerOffsetY',
  'lightLayerOverlayVisible',
  'lightLayerOverlayMinimized',
  'isLightLayerRecording',
  'lightRecordingTool',
  'lightLayerEnabled',
  'lightLayerRotation',
  'lightPanelX',
  'lightPanelY'
];

stateVarsToRemove.forEach(varName => {
  // Match full useState declaration line with comment
  const pattern = new RegExp(`\\s*const \\[${varName},[^\\]]+\\][^;]*;[^\\n]*\\n`, 'g');
  if (pattern.test(content)) {
    content = content.replace(pattern, '');
    removedSections.push(`State: ${varName}`);
  }
});

// 6. Remove all useRef declarations for light layer
const refVarsToRemove = [
  'lightRecordingStartFrameRef',
  'isDraggingLightLayer',
  'lightLayerDragStart',
  'lightLayerOriginalTransform',
  'lightLayerPinchStart',
  'lightLayerRotationStart',
  'lightPanelDragStart',
  'currentLightRecordingKeyframes',
  'pendingKeyframesRef'
];

refVarsToRemove.forEach(varName => {
  const pattern = new RegExp(`\\s*const ${varName} = useRef[^;]+;[^\\n]*\\n`, 'g');
  if (pattern.test(content)) {
    content = content.replace(pattern, '');
    removedSections.push(`Ref: ${varName}`);
  }
});

// 7. Remove light layer from dependency arrays
const varsToRemoveFromDeps = [
  'lightLayerActive', 'lightLayerStrokes', 'lightLayerRecordings', 'activeLightRecordingId',
  'lightLayerAlpha', 'lightLayerBrightness', 'lightLayerScale', 'lightLayerOffsetX',
  'lightLayerOffsetY', 'lightLayerOverlayVisible', 'isLightLayerRecording', 'lightRecordingTool',
  'lightLayerEnabled', 'lightLayerRotation', 'lightPanelX', 'lightPanelY', 'playingRecordingId'
];

varsToRemoveFromDeps.forEach(varName => {
  // Remove from dependency arrays: ", varName" or "varName, "
  content = content.replace(new RegExp(`,\\s*${varName}(?=\\s*[,\\]])`, 'g'), '');
  content = content.replace(new RegExp(`(?<=\\[)\\s*${varName}\\s*,`, 'g'), '');
  content = content.replace(new RegExp(`(?<=\\[)\\s*${varName}\\s*(?=\\])`, 'g'), '');
});
removedSections.push('Cleaned dependency arrays');

// 8. Remove light layer logic from handleTouchGrant
const grantPattern = /console\.log\(`\[FRAMER TOUCH\] Grant - lightLayerActive[^}]+\}/s;
if (grantPattern.test(content)) {
  content = content.replace(grantPattern, '');
  removedSections.push('Light layer logic from handleTouchGrant');
}

// 9. Remove light layer conditional blocks in touch handlers
// These are complex multi-line blocks, so we'll handle them with broader patterns

// Remove "if (lightLayerActive && lightRecordingTool === 'hand')" blocks
content = content.replace(/\s*if \(lightLayerActive && lightRecordingTool === ['"]hand['"]\)[^}]*\{[^}]*\}/g, '');

// Remove "if (isDraggingLightLayer.current)" blocks
content = content.replace(/\s*if \(isDraggingLightLayer\.current\)[^}]*\{(?:[^{}]|\{[^}]*\})*\}/gs, '');

// Remove "if (isLightLayerRecording" conditional blocks
content = content.replace(/\s*if \(isLightLayerRecording[^}]*\{(?:[^{}]|\{[^}]*\})*\}/gs, '');

removedSections.push('Light layer conditional blocks in touch handlers');

// 10. Remove light layer from getFramerState
content = content.replace(/\s*activeLightRecordingId,?\s*/g, '');
removedSections.push('Light layer from getFramerState');

// 11. Remove light layer from save/load functions
content = content.replace(/\s*if \(project\.activeLightRecordingId\)[^}]*\{[^}]*\}/g, '');
content = content.replace(/\s*if \(slotData\.activeLightRecordingId\)[^}]*\{[^}]*\}/g, '');
removedSections.push('Light layer from save/load');

// 12. Remove playingRecordingId state
content = content.replace(/\s*const \[playingRecordingId,[^\]]+\][^;]*;[^\n]*\n/g, '');

// 13. Remove recordingsScrollViewRef
content = content.replace(/\s*const recordingsScrollViewRef = useRef[^;]+;[^\n]*\n/g, '');

// 14. Remove recordingPulseScale animations
content = content.replace(/\s*const recordingPulseScale = useRef[^;]+;[^\n]*\n/g, '');

// 15. Remove useEffect blocks that are light-layer specific
// These check for isLightLayerRecording, activeLightRecordingId, etc.
const effectPatterns = [
  /\s*useEffect\(\(\) => \{[^}]*isLightLayerRecording[^}]*\}(?:,[^;]*)?;/gs,
  /\s*useEffect\(\(\) => \{[^}]*activeLightRecordingId[^}]*\}(?:,[^;]*)?;/gs,
  /\s*useEffect\(\(\) => \{[^}]*lightRecordingStartFrameRef[^}]*\}(?:,[^;]*)?;/gs,
  /\s*useEffect\(\(\) => \{[^}]*playingRecordingId[^}]*\}(?:,[^;]*)?;/gs,
];

effectPatterns.forEach((pattern, i) => {
  if (pattern.test(content)) {
    content = content.replace(pattern, '');
    removedSections.push(`useEffect block ${i + 1} (light layer interpolation/recording)`);
  }
});

// 16. Remove the entire light layer overlay UI
// Find the light layer button and overlay sections

// Remove light layer button (around line 5557-5590)
const lightButtonPattern = /\s*\{\/\* Light Layer Button - 💡[^}]+\{\/\*[^}]+\*\/\}\s*<\/TouchableOpacity>/s;
if (lightButtonPattern.test(content)) {
  content = content.replace(lightButtonPattern, '');
  removedSections.push('Light layer button (💡)');
}

// Remove the massive light layer overlay modal (starts around line 6145)
// This is the most complex part - the entire overlay with all controls
const overlayPattern = /\s*\{\/\* Light Layer Overlay[^}]+(?:Modal|View)[^}]+lightLayerOverlayVisible[^}]+(?:<\/Modal>|<\/View>)/gs;
if (overlayPattern.test(content)) {
  content = content.replace(overlayPattern, '');
  removedSections.push('Light layer overlay panel UI');
}

// Simpler approach: Find and remove the Modal with lightLayerOverlayVisible
content = content.replace(
  /<Modal[^>]*visible=\{lightLayerOverlayVisible\}[^>]*>[\s\S]*?<\/Modal>/g,
  ''
);
removedSections.push('Light layer Modal component');

// 17. Remove any remaining 💡 emoji references
content = content.replace(/💡/g, '');
removedSections.push('Light bulb emoji (💡) references');

// 18. Clean up any double blank lines created by removals
content = content.replace(/\n\n\n+/g, '\n\n');

// Write back
fs.writeFileSync(FILE_PATH, content);

const finalLines = content.split('\n').length;
const finalSize = content.length;
const removedLines = originalLines - finalLines;
const removedBytes = originalSize - finalSize;

console.log('\n✅ REMOVAL COMPLETE\n');
console.log(`📊 Statistics:`);
console.log(`   Original: ${originalLines} lines, ${originalSize} bytes`);
console.log(`   Final: ${finalLines} lines, ${finalSize} bytes`);
console.log(`   Removed: ${removedLines} lines, ${removedBytes} bytes`);
console.log(`   Reduction: ${((removedBytes / originalSize) * 100).toFixed(1)}%`);
console.log(`\n🗑️  Removed ${removedSections.length} sections:`);
removedSections.forEach((section, i) => {
  console.log(`   ${i + 1}. ${section}`);
});
console.log(`\n💾 Backup saved to: ${BACKUP_PATH}`);
console.log(`\n⚠️  Next steps:`);
console.log(`   1. Review the changes`);
console.log(`   2. Test compilation: npx react-native run-ios`);
console.log(`   3. If issues, restore from backup`);
