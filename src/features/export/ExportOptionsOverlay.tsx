import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXPORT_TITLE_EMOJIS = ['🧑‍🔧', '👩‍🔧', '👨‍🔧'];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ExportOptionsOverlayProps {
  exportOptionsVisible: boolean;
  isExporting: boolean;
  IS_IPAD: boolean;
  exportFormat: 'png' | 'gif' | 'mov';
  exportOptionsType: 'image' | 'video';
  exportTitleEmojiIndex: number;
  pngExportSize: '4k' | '8k' | '12k';
  setPngExportSize: (size: '4k' | '8k' | '12k') => void;
  setExportOptionsVisible: (visible: boolean) => void;
  handleExportOptionCancel: () => void | Promise<void>;
  handleExportOptionShare: () => void | Promise<void>;
  handleExportOptionSaveToPhotos: () => void | Promise<void>;
  handleExportOptionOpenInAr: () => void | Promise<void>;
  quickSaveProject: () => Promise<void>;
  saveCustomBrushHandler: () => Promise<void>;
  closeExportOptions: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExportOptionsOverlay({
  exportOptionsVisible,
  isExporting: _isExporting,
  IS_IPAD,
  exportFormat: _exportFormat,
  exportOptionsType,
  exportTitleEmojiIndex,
  pngExportSize,
  setPngExportSize,
  setExportOptionsVisible,
  handleExportOptionCancel,
  handleExportOptionShare,
  handleExportOptionSaveToPhotos,
  handleExportOptionOpenInAr,
  quickSaveProject,
  saveCustomBrushHandler,
  closeExportOptions,
}: ExportOptionsOverlayProps): React.ReactElement {
  return (
    /* Export Options Overlay */
    <Modal
      visible={exportOptionsVisible}
      animationType="fade"
      transparent
      onRequestClose={handleExportOptionCancel}
      supportedOrientations={IS_IPAD ? ['portrait', 'landscape'] : ['portrait']}
    >
      <View style={styles.exportOptionsOverlay}>
        <TouchableOpacity
          style={styles.exportOptionsBackdrop}
          activeOpacity={1}
          onPress={handleExportOptionCancel}
        />
        <View style={styles.exportOptionsPanel}>
          <Text style={styles.exportOptionsTitle}>
            {EXPORT_TITLE_EMOJIS[exportTitleEmojiIndex]} Options:
          </Text>
          <Text style={styles.exportOptionsSubtitle}>Choose an option</Text>

          {/* PNG Export Size Selector (only show for images) */}
          {exportOptionsType === 'image' && (
            <View style={{ marginBottom: 16 }}>
              <Text
                style={{
                  color: '#888',
                  fontSize: 14,
                  fontFamily: 'vrtlfinal',
                  marginBottom: 8,
                  textAlign: 'center',
                }}
              >
                PNG Export Size
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={{
                    flex: 1,
                    backgroundColor: pngExportSize === '4k' ? '#4CAF50' : '#2a2a2a',
                    borderRadius: 8,
                    padding: 12,
                    borderWidth: 2,
                    borderColor: pngExportSize === '4k' ? '#4CAF50' : '#444',
                    alignItems: 'center',
                  }}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setPngExportSize('4k');
                  }}
                >
                  <Text
                    style={{
                      color: pngExportSize === '4k' ? '#fff' : '#888',
                      fontSize: 12,
                      fontWeight: '700',
                      fontFamily: 'vrtlfinal',
                    }}
                  >
                    4K
                  </Text>
                  <Text
                    style={{
                      color: pngExportSize === '4k' ? '#aaa' : '#666',
                      fontSize: 10,
                      fontFamily: 'vrtlfinal',
                    }}
                  >
                    4096px
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{
                    flex: 1,
                    backgroundColor: pngExportSize === '8k' ? '#4CAF50' : '#2a2a2a',
                    borderRadius: 8,
                    padding: 12,
                    borderWidth: 2,
                    borderColor: pngExportSize === '8k' ? '#4CAF50' : '#444',
                    alignItems: 'center',
                  }}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setPngExportSize('8k');
                  }}
                >
                  <Text
                    style={{
                      color: pngExportSize === '8k' ? '#fff' : '#888',
                      fontSize: 12,
                      fontWeight: '700',
                      fontFamily: 'vrtlfinal',
                    }}
                  >
                    8K
                  </Text>
                  <Text
                    style={{
                      color: pngExportSize === '8k' ? '#aaa' : '#666',
                      fontSize: 10,
                      fontFamily: 'vrtlfinal',
                    }}
                  >
                    8192px
                  </Text>
                </TouchableOpacity>
                {/* 12K - iPad only */}
                {IS_IPAD && (
                  <TouchableOpacity
                    style={{
                      flex: 1,
                      backgroundColor: pngExportSize === '12k' ? '#4CAF50' : '#2a2a2a',
                      borderRadius: 8,
                      padding: 12,
                      borderWidth: 2,
                      borderColor: pngExportSize === '12k' ? '#4CAF50' : '#444',
                      alignItems: 'center',
                    }}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setPngExportSize('12k');
                    }}
                  >
                    <Text
                      style={{
                        color: pngExportSize === '12k' ? '#fff' : '#888',
                        fontSize: 12,
                        fontWeight: '700',
                        fontFamily: 'vrtlfinal',
                      }}
                    >
                      12K
                    </Text>
                    <Text
                      style={{
                        color: pngExportSize === '12k' ? '#aaa' : '#666',
                        fontSize: 10,
                        fontFamily: 'vrtlfinal',
                      }}
                    >
                      12288px
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          <TouchableOpacity
            style={styles.exportOptionButton}
            onPress={handleExportOptionShare}
          >
            <Text style={styles.exportOptionIcon}>📤</Text>
            <Text style={styles.exportOptionLabel}>Share</Text>
          </TouchableOpacity>

          {/* Save Project - Own row with save icons */}
          <View style={{ marginVertical: 8 }}>
            <TouchableOpacity
              style={[
                styles.exportOptionButton,
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: 20,
                },
              ]}
              onPress={async () => {
                setExportOptionsVisible(false);
                await quickSaveProject();
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={styles.exportOptionIcon}>💾</Text>
                <Text style={styles.exportOptionLabel}>Save Project</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{ fontSize: 20 }}>💿</Text>
                <Text style={{ fontSize: 20 }}>💽</Text>
              </View>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.exportOptionButton}
            onPress={handleExportOptionSaveToPhotos}
          >
            <Text style={styles.exportOptionIcon}>📷</Text>
            <Text style={styles.exportOptionLabel}>Save to Photos</Text>
          </TouchableOpacity>

          {/* Save as Stroke - Custom Brush Option (PNG only) */}
          {exportOptionsType === 'image' && (
            <TouchableOpacity
              style={styles.exportOptionButton}
              onPress={handleExportOptionOpenInAr}
            >
              <Text style={styles.exportOptionIcon}>🧱</Text>
              <Text style={styles.exportOptionLabel}>Open in AR Scene</Text>
            </TouchableOpacity>
          )}

          {exportOptionsType === 'image' && (
            <TouchableOpacity
              style={styles.exportOptionButton}
              onPress={async () => {
                closeExportOptions();
                await saveCustomBrushHandler();
              }}
            >
              <Text style={styles.exportOptionIcon}>🎨</Text>
              <Text style={styles.exportOptionLabel}>Save as Stroke</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.exportOptionButton, styles.exportOptionCancelButton]}
            onPress={handleExportOptionCancel}
          >
            <Text style={styles.exportOptionCancelLabel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  exportOptionsOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
  exportOptionsBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  exportOptionsPanel: {
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
    padding: 24,
    width: '85%',
    maxWidth: 400,
    gap: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  exportOptionsTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 4,
  },
  exportOptionsSubtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginBottom: 12,
  },
  exportOptionButton: {
    backgroundColor: '#2a2a2a',
    borderRadius: 16,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  exportOptionIcon: {
    fontSize: 28,
  },
  exportOptionLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
    flex: 1,
  },
  exportOptionCancelButton: {
    backgroundColor: '#1a1a1a',
    borderColor: '#444',
    marginTop: 8,
  },
  exportOptionCancelLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: '#ff6b6b',
    textAlign: 'center',
    flex: 1,
  },
});
