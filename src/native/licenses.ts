import { NativeModules, Platform } from 'react-native';

type LicensesModule = {
  presentLicenses: () => void;
};

const NativeLicenses: LicensesModule | undefined = NativeModules.LicensesPresenter;

export const presentLicensesOverlay = (): void => {
  if (Platform.OS !== 'ios') {
    console.warn('[Licenses] Overlay only available on iOS for now');
    return;
  }

  if (NativeLicenses?.presentLicenses) {
    NativeLicenses.presentLicenses();
  } else {
    console.warn('[Licenses] Native module not found');
  }
};

export default {
  presentLicenses: presentLicensesOverlay
};
