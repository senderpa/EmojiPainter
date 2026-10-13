import { Platform, StyleSheet } from 'react-native';
import {
  OVERLAY_BUTTON_PADDING_H,
  OVERLAY_BUTTON_PADDING_V,
  OVERLAY_BUTTON_RADIUS,
  OVERLAY_BUTTON_WIDTH,
  OVERLAY_FONT_SIZE,
  QUICK_BUTTON_RADIUS,
  QUICK_BUTTON_SIZE,
  QUICK_EMOJI_SIZE,
  TOOL_SCALE,
} from '../lib/paintConstants';

/**
 * Shared styles for the normal-workspace components (WorkspaceToolbar,
 * BrushControls, QuickActionsStrip) when they are reused OUTSIDE PaintScreen —
 * currently Vector Mode and the Profil Studio.
 *
 * Vector Mode reuses the normal workspace's own components — WorkspaceToolbar,
 * BrushControls, QuickActionsStrip — which are driven by an injected `styles`
 * object. These keys/values mirror PaintScreen's so the two workspaces are
 * visually identical; only the vector-specific side rail is defined locally in
 * VectorWorkspace.
 */
const sharedWorkspaceStyles = StyleSheet.create({
  // ── Top toolbar (tools + brush, options drop under the brush button) ──────
  toolbarOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 30,
    paddingHorizontal: 16,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Math.round(12 * TOOL_SCALE),
    backgroundColor: 'rgba(15,15,15,0.92)',
    borderRadius: Math.round(20 * TOOL_SCALE),
    paddingHorizontal: Math.round(18 * TOOL_SCALE),
    paddingVertical: Math.round(10 * TOOL_SCALE),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2d2d2d',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  toolButton: {
    backgroundColor: 'rgba(31,31,31,0.85)',
    borderRadius: OVERLAY_BUTTON_RADIUS,
    paddingHorizontal: OVERLAY_BUTTON_PADDING_H,
    paddingVertical: OVERLAY_BUTTON_PADDING_V,
    minWidth: OVERLAY_BUTTON_WIDTH,
    alignItems: 'center',
  },
  toolButtonActive: {
    backgroundColor: '#ff6b6b',
  },
  toolEmoji: {
    fontSize: OVERLAY_FONT_SIZE,
    color: '#fff',
  },
  disabledButton: {
    opacity: 0.35,
  },

  // ── Bottom brush controls ────────────────────────────────────────────────
  sizeControls: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: Math.round(12 * TOOL_SCALE),
    paddingHorizontal: Math.round(6 * TOOL_SCALE),
    paddingVertical: Math.round(8 * TOOL_SCALE),
    width: '100%',
    // Never wrap. If the row runs out of room the columns must SHRINK; wrapping is what put
    // the picked emoji and the spacing value underneath the slider on narrower iPads.
    flexWrap: 'nowrap',
  },
  brushControlColumn: {
    flex: 1,
    // A flex child defaults to minWidth:auto and will NOT shrink past its content, which is how
    // fixed label/value widths pushed this row wider than the screen. 0 lets it actually shrink.
    minWidth: 0,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    paddingHorizontal: Math.round(8 * TOOL_SCALE),
    paddingVertical: Math.round(4 * TOOL_SCALE),
    gap: Math.round(10 * TOOL_SCALE),
  },
  spacingControlColumn: {
    flex: 1,
    // A flex child defaults to minWidth:auto and will NOT shrink past its content, which is how
    // fixed label/value widths pushed this row wider than the screen. 0 lets it actually shrink.
    minWidth: 0,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    paddingHorizontal: Math.round(8 * TOOL_SCALE),
    paddingVertical: Math.round(4 * TOOL_SCALE),
    gap: Math.round(10 * TOOL_SCALE),
  },
  opacityToggle: {
    backgroundColor: 'transparent',
    borderRadius: 14,
    paddingHorizontal: Math.round(16 * TOOL_SCALE),
    paddingVertical: Math.round(10 * TOOL_SCALE),
    alignItems: 'center',
    justifyContent: 'center',
  },
  opacityToggleEmoji: {
    fontSize: Math.round(20 * TOOL_SCALE),
    color: '#fff',
  },
  sizeSlider: {
    flex: 1,
  },
  sliderEmoji: {
    fontSize: Math.round(20 * TOOL_SCALE),
    minWidth: Math.round(26 * TOOL_SCALE),
    textAlign: 'left',
    color: '#fff',
  },
  sliderInput: {
    width: Math.round(54 * TOOL_SCALE),
    paddingHorizontal: 8,
    paddingVertical: Platform.OS === 'ios' ? 6 : 3,
    borderRadius: 8,
    backgroundColor: '#1f1f1f',
    color: '#fff',
    textAlign: 'right',
    fontSize: Math.round(14 * TOOL_SCALE),
  },
  sliderInputIpad: {
    width: Math.round(54 * TOOL_SCALE) - 30,
  },
  spacingValueLabel: {
    width: Math.round(70 * TOOL_SCALE),
    textAlign: 'right',
    color: '#ffdc82',
    fontSize: Math.round(13 * TOOL_SCALE),
  },

  // ── Bottom quick actions (save / picker / trace / export / close) ─────────
  traceControls: {
    backgroundColor: 'transparent',
    paddingHorizontal: Math.round(14 * TOOL_SCALE),
    paddingVertical: Math.round(12 * TOOL_SCALE),
    gap: Math.round(16 * TOOL_SCALE),
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Math.round(8 * TOOL_SCALE),
  },
  quickActionStaticWrapper: {
    borderRadius: QUICK_BUTTON_RADIUS,
  },
  quickActionButton: {
    backgroundColor: '#1f1f1f',
    borderRadius: QUICK_BUTTON_RADIUS,
    width: QUICK_BUTTON_SIZE,
    height: QUICK_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionEmoji: {
    fontSize: QUICK_EMOJI_SIZE,
    lineHeight: QUICK_EMOJI_SIZE + 4,
    color: '#fff',
    textAlign: 'center',
  },
  infoButtonWrapper: {
    borderRadius: QUICK_BUTTON_RADIUS,
  },
  infoButton: {
    backgroundColor: '#2b1f1a',
  },
});

export default sharedWorkspaceStyles;
