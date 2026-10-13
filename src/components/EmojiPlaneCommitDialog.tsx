import React from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import BrushEmojiIcon from './BrushEmojiIcon';

interface EmojiPlane {
  id: string;
  emoji: string;
  visible?: boolean;
}

interface EmojiPlaneCommitDialogProps {
  visible: boolean;
  emojiPlanes: EmojiPlane[];
  onCommitAll: () => void;
  onLater: () => void;
  onDeleteAll: () => void;
}

export default function EmojiPlaneCommitDialog({
  visible,
  emojiPlanes,
  onCommitAll,
  onLater,
  onDeleteAll,
}: EmojiPlaneCommitDialogProps) {
  const uncommittedPlanes = emojiPlanes.filter(p => p.visible !== false);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onLater}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}>
        <View style={{
          backgroundColor: '#1a1a1a',
          borderRadius: 16,
          padding: 20,
          width: '80%',
          maxWidth: 380,
          borderWidth: 2,
          borderColor: '#ff6b6b',
        }}>
          {/* Show uncommitted emojis */}
          <View style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'center',
            alignItems: 'center',
            marginBottom: 20,
            gap: 12,
          }}>
            {uncommittedPlanes.map((plane) => (
              <BrushEmojiIcon
                key={plane.id}
                emoji={plane.emoji}
                size={36}
                textStyle={{ fontSize: 36, lineHeight: 44 }}
              />
            ))}
          </View>

          {/* Count indicator */}
          <Text style={{
            fontSize: 16,
            fontWeight: 'bold',
            color: '#fff',
            textAlign: 'center',
            marginBottom: 20,
            fontFamily: 'vrtlfinal',
          }}>
            {uncommittedPlanes.length} uncommitted
          </Text>

          {/* Action buttons in a row */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {/* Commit All Button */}
            <TouchableOpacity
              style={{
                flex: 1,
                backgroundColor: '#ff6b6b',
                paddingVertical: 12,
                borderRadius: 8,
                justifyContent: 'center',
                alignItems: 'center',
              }}
              onPress={onCommitAll}
            >
              <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#fff', fontFamily: 'vrtlfinal' }}>
                Commit All
              </Text>
            </TouchableOpacity>

            {/* Later Button */}
            <TouchableOpacity
              style={{
                flex: 1,
                backgroundColor: 'rgba(255,255,255,0.15)',
                paddingVertical: 12,
                borderRadius: 8,
                justifyContent: 'center',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.3)',
              }}
              onPress={onLater}
            >
              <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#fff', fontFamily: 'vrtlfinal' }}>
                Later
              </Text>
            </TouchableOpacity>

            {/* Delete Button */}
            <TouchableOpacity
              style={{
                flex: 1,
                backgroundColor: 'rgba(200,50,50,0.6)',
                paddingVertical: 12,
                borderRadius: 8,
                justifyContent: 'center',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: 'rgba(255,100,100,0.5)',
              }}
              onPress={onDeleteAll}
            >
              <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#ff9999', fontFamily: 'vrtlfinal' }}>
                Delete
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
