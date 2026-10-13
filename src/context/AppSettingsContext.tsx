import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type ThemeMode = 'dark' | 'light';
type HandMode = 'right' | 'left';
type BrushPerformanceMode = 'speed' | 'quality';

interface AppSettings {
  theme: ThemeMode;
  handMode: HandMode;
  soundEnabled: boolean;
  helperModeEnabled: boolean;
  tutorialModeEnabled: boolean;
  brushPerformanceMode: BrushPerformanceMode;
}

interface AppSettingsContextValue {
  settings: AppSettings;
  setTheme: (theme: ThemeMode) => void;
  setHandMode: (mode: HandMode) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setHelperModeEnabled: (enabled: boolean) => void;
  setTutorialModeEnabled: (enabled: boolean) => void;
  setBrushPerformanceMode: (mode: BrushPerformanceMode) => void;
  colors: {
    background: string;
    surface: string;
    surfaceAlt: string;
    text: string;
    textSecondary: string;
    border: string;
  };
}

const defaultSettings: AppSettings = {
  theme: 'dark',
  handMode: 'right',
  soundEnabled: true,
  helperModeEnabled: false,
  tutorialModeEnabled: false,
  brushPerformanceMode: 'speed',
};

const AppSettingsContext = createContext<AppSettingsContextValue | undefined>(undefined);

const STORAGE_KEY = '@app_settings';
const HELPER_INTRO_KEY = '@helper_intro_step';

export const AppSettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);

  // Load settings from storage on mount, with first-use helper mode onboarding
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [stored, introStep] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(HELPER_INTRO_KEY),
        ]);

        const parsed: Partial<AppSettings> = stored ? (JSON.parse(stored) as Partial<AppSettings>) : {};

        if (!introStep) {
          // First ever launch — auto-enable helper mode
          await AsyncStorage.setItem(HELPER_INTRO_KEY, '1');
          setSettings(prev => ({ ...prev, ...parsed, helperModeEnabled: true }));
        } else if (introStep === '1') {
          // Second launch — auto-disable helper mode so it stays clean by default
          await AsyncStorage.setItem(HELPER_INTRO_KEY, '2');
          setSettings(prev => ({ ...prev, ...parsed, helperModeEnabled: false }));
        } else {
          // Third launch and beyond — respect whatever the user has set
          if (stored) {
            setSettings(prev => ({ ...prev, ...parsed }));
          }
        }
      } catch (error) {
        console.error('[AppSettings] Failed to load settings:', error);
      }
    };
    loadSettings();
  }, []);

  // Save settings to storage whenever they change
  useEffect(() => {
    const saveSettings = async () => {
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch (error) {
        console.error('[AppSettings] Failed to save settings:', error);
      }
    };
    saveSettings();
  }, [settings]);

  const setTheme = (theme: ThemeMode) => {
    setSettings(prev => ({ ...prev, theme }));
  };

  const setHandMode = (mode: HandMode) => {
    setSettings(prev => ({ ...prev, handMode: mode }));
  };

  const setSoundEnabled = (enabled: boolean) => {
    setSettings(prev => ({ ...prev, soundEnabled: enabled }));
  };

  const setHelperModeEnabled = (enabled: boolean) => {
    setSettings(prev => ({ ...prev, helperModeEnabled: enabled }));
  };

  const setTutorialModeEnabled = (enabled: boolean) => {
    setSettings(prev => ({ ...prev, tutorialModeEnabled: enabled }));
  };

  const setBrushPerformanceMode = (mode: BrushPerformanceMode) => {
    setSettings(prev => ({ ...prev, brushPerformanceMode: mode }));
  };

  // Generate theme colors based on current theme
  const colors = settings.theme === 'dark'
    ? {
        background: '#0c0c0c',
        surface: '#1a1a1a',
        surfaceAlt: '#141414',
        text: '#ffffff',
        textSecondary: '#888888',
        border: '#333333'
      }
    : {
        background: '#ffffff',
        surface: '#f5f5f5',
        surfaceAlt: '#e8e8e8',
        text: '#000000',
        textSecondary: '#666666',
        border: '#cccccc'
      };

  return (
    <AppSettingsContext.Provider value={{ settings, setTheme, setHandMode, setSoundEnabled, setHelperModeEnabled, setTutorialModeEnabled, setBrushPerformanceMode, colors }}>
      {children}
    </AppSettingsContext.Provider>
  );
};

export const useAppSettings = (): AppSettingsContextValue => {
  const context = useContext(AppSettingsContext);
  if (!context) {
    throw new Error('useAppSettings must be used within AppSettingsProvider');
  }
  return context;
};
