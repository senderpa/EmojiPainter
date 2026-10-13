import React from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity } from 'react-native';

interface PinLockModalProps {
  visible: boolean;
  pinLockValue: string;
  pinLockError: string;
  onChangeText: (text: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function PinLockModal({
  visible,
  pinLockValue,
  pinLockError,
  onChangeText,
  onConfirm,
  onCancel,
}: PinLockModalProps) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <TouchableOpacity
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', justifyContent: 'center', alignItems: 'center', padding: 28 }}
        activeOpacity={1}
        onPress={onCancel}
      >
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ width: '100%', maxWidth: 360 }}>
          <View style={{ backgroundColor: '#0f0f0f', borderRadius: 24, padding: 28, borderWidth: 2, borderColor: '#FF9500' }}>
            <Text style={{ fontSize: 40, textAlign: 'center', marginBottom: 12 }}>🛡️</Text>
            <Text style={{ color: '#FF9500', fontSize: 20, fontWeight: '800', fontFamily: 'vrtlfinal', textAlign: 'center', marginBottom: 6 }}>
              Parental PIN Required
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginBottom: 20 }}>
              Enter the parent PIN to switch back online
            </Text>
            <TextInput
              style={{
                backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 2,
                borderColor: pinLockError ? '#f44' : '#444',
                color: '#fff', fontSize: 28, textAlign: 'center',
                letterSpacing: 10, paddingVertical: 14, marginBottom: 8,
              }}
              value={pinLockValue}
              onChangeText={(t) => {
                onChangeText(t.replace(/[^0-9]/g, '').slice(0, 6));
              }}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              placeholder="••••"
              placeholderTextColor="#444"
              autoFocus
            />
            {pinLockError ? (
              <Text style={{ color: '#f44', fontSize: 13, textAlign: 'center', marginBottom: 10 }}>{pinLockError}</Text>
            ) : (
              <View style={{ height: 23 }} />
            )}
            <TouchableOpacity
              style={{ backgroundColor: '#FF9500', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 10 }}
              onPress={() => void onConfirm()}
              activeOpacity={0.8}
            >
              <Text style={{ color: '#000', fontSize: 17, fontWeight: '800', fontFamily: 'vrtlfinal' }}>Unlock →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 8 }} onPress={onCancel} activeOpacity={0.7}>
              <Text style={{ color: '#666', fontSize: 14, fontFamily: 'vrtlfinal' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}
