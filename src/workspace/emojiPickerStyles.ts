/**
 * emojiPickerStyles — the exact Brush Library (EmojiPickerModal) styles, lifted
 * out of PaintScreen so the AR painting + face scenes can render the SAME full
 * picker (last-picked preview, recents, mirror/rotate, spacing slider, grid).
 *
 * Keep these in sync with the master definitions in PaintScreen.tsx.
 */
import { Platform, StyleSheet } from 'react-native';

const IS_IPAD = Platform.OS === 'ios' && (Platform as any)?.isPad === true;

export const emojiPickerStyles = StyleSheet.create({
  pickerContainer: {
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    backgroundColor: '#111111',
    paddingTop: 48,
    paddingLeft: 24,
    paddingRight: IS_IPAD ? 60 : 24,
    paddingBottom: 32,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  pickerHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginRight: 12,
  },
  pickerCloseIcon: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '700',
  },
  pickerSpacingSlider: {
    flex: 1,
    height: 32,
  },
  pickerSelectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1f1f1f',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2a2a',
  },
  pickerSelectedLabel: {
    color: '#bbbbbb',
    fontSize: 14,
    fontWeight: '600',
  },
  pickerSelectedEmojiBubble: {
    backgroundColor: '#2d2d2d',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  pickerSelectedEmoji: {
    fontSize: 30,
    lineHeight: 34,
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'System', default: undefined }),
  },
  recentSection: {
    marginBottom: 12,
  },
  recentLabel: {
    color: '#bbb',
    fontSize: 14,
    marginBottom: 6,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  recentEmojiButton: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  recentEmojiButtonActive: {
    backgroundColor: '#ff6b6b',
  },
  recentEmoji: {
    fontSize: 20,
    lineHeight: 24,
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'System', default: undefined }),
  },
  pickerTitle: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 20,
    marginBottom: 0,
    textAlign: 'left',
  },
  pickerSearch: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#fff',
    marginBottom: 14,
  },
  pickerFlipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 18,
  },
  pickerFlipButton: {
    flex: 1,
    backgroundColor: '#202020',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#303030',
  },
  pickerFlipButtonActive: {
    backgroundColor: '#ff6b6b',
    borderColor: '#ff6b6b',
  },
  pickerFlipEmoji: {
    fontSize: 18,
    lineHeight: 20,
  },
  pickerFlipEmojiActive: {
    color: '#050505',
  },
  pickerFlipLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
});

export default emojiPickerStyles;
