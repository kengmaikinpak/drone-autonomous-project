import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { SettingsContextType, DroneSettings } from '@/types';

const defaultSettings: DroneSettings = {
  mavlinkSystemId: 1,
  maxAltitude: 90,
  rtlAltitude: 30,
  lowBatteryThreshold: 20,
  rcLossAction: 'RTL',
  takeoffAltitude: 3.0,
  cruiseSpeed: 5,
  hoverTime: 5,
};

const SettingsContext = createContext<SettingsContextType>({
  settings: defaultSettings,
  updateSettings: () => {},
});

export const useSettings = () => useContext(SettingsContext);

interface Props {
  children: React.ReactNode;
}

export const SettingsProvider: React.FC<Props> = ({ children }) => {
  const [settings, setSettings] = useState<DroneSettings>(() => {
    try {
      const saved = localStorage.getItem('droneSettings');
      return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
    } catch {
      return defaultSettings;
    }
  });

  useEffect(() => {
    localStorage.setItem('droneSettings', JSON.stringify(settings));
  }, [settings]);

  // Sync across tabs
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'droneSettings') {
        try {
          const newSettings = e.newValue ? JSON.parse(e.newValue) : defaultSettings;
          setSettings(prev => ({ ...prev, ...newSettings }));
        } catch {
          console.error('Failed to sync settings across tabs');
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const updateSettings = useCallback((newSettings: Partial<DroneSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};
