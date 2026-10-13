import { Platform, NativeModules } from 'react-native';

export function logNativeHealth() {
  if (__DEV__ && Platform.OS === 'ios') {
    const missing: string[] = [];
    const required = [
      'TimelapseExporterModule',
      'ExpoFileSystem',
      'ExpoMediaLibrary',
    ];
    for (const key of required) {
      if (!(NativeModules as any)[key]) missing.push(key);
    }
    if (missing.length) {
      // eslint-disable-next-line no-console
      console.warn('[health] Missing native modules:', missing.join(', '));
    } else {
      // eslint-disable-next-line no-console
      console.log('[health] Native modules OK');
    }
  }
}

