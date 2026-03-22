import React, { useState, useEffect } from 'react';
import { X, Network, ShieldAlert, Navigation } from 'lucide-react';
import { useRos } from '@/contexts/RosContext';
import { useSettings } from '@/contexts/SettingsContext';
import type { DroneSettings } from '@/types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'General' | 'Safety' | 'Mission';

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { rosIp, setRosIp, sendSettingsToROS } = useRos();
  const { settings, updateSettings } = useSettings();

  const [activeTab, setActiveTab] = useState<TabType>('General');
  const [ipInput, setIpInput] = useState(rosIp);
  const [localSettings, setLocalSettings] = useState<DroneSettings>(settings);

  useEffect(() => {
    if (isOpen) {
      setIpInput(rosIp);
      setLocalSettings(settings);
      setActiveTab('General');
    }
  }, [isOpen, rosIp, settings]);

  const handleSave = () => {
    setRosIp(ipInput);
    updateSettings(localSettings);
    sendSettingsToROS(localSettings);
    onClose();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setLocalSettings(prev => ({
      ...prev,
      [name]: type === 'number' ? parseFloat(value) : value,
    }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50">
      <div className="bg-white rounded-xl shadow-2xl w-[600px] h-[470px] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 bg-slate-800 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-blue-400" />
            <h2 className="font-bold text-lg tracking-wider">Settings</h2>
          </div>
          <button onClick={onClose} className="hover:bg-white/20 p-1 rounded transition text-slate-300 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden" style={{ height: '400px' }}>
          {/* Tabs */}
          <div className="w-1/3 bg-slate-50 border-r border-slate-200 p-2 flex flex-col gap-1">
            <button
              onClick={() => setActiveTab('General')}
              className={`p-3 rounded-lg flex items-center gap-3 text-sm font-bold transition ${activeTab === 'General' ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-200'}`}
            >
              <Network className="w-4 h-4" /> General
            </button>
            <button
              onClick={() => setActiveTab('Safety')}
              className={`p-3 rounded-lg flex items-center gap-3 text-sm font-bold transition ${activeTab === 'Safety' ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-200'}`}
            >
              <ShieldAlert className="w-4 h-4" /> Safety
            </button>
            <button
              onClick={() => setActiveTab('Mission')}
              className={`p-3 rounded-lg flex items-center gap-3 text-sm font-bold transition ${activeTab === 'Mission' ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-200'}`}
            >
              <Navigation className="w-4 h-4" /> Mission
            </button>
          </div>

          {/* Content */}
          <div className="w-2/3 p-6 overflow-y-auto sidebar-scroll">
            {activeTab === 'General' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    ROS Connection Address
                  </label>
                  <input
                    type="text"
                    value={ipInput}
                    onChange={(e) => setIpInput(e.target.value)}
                    placeholder="e.g., localhost:9090"
                    className="w-full bg-slate-50 border border-slate-300 text-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">IP address and port of your ROS bridge server.</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    MAVLink System ID
                  </label>
                  <input
                    type="number"
                    name="mavlinkSystemId"
                    value={localSettings.mavlinkSystemId}
                    onChange={handleChange}
                    className="w-full bg-slate-50 border border-slate-300 text-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Unique ID for this drone vehicle.</p>
                </div>
              </div>
            )}

            {activeTab === 'Safety' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Max Altitude (m)</label>
                  <input type="number" name="maxAltitude" value={localSettings.maxAltitude} onChange={handleChange} className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">RTL Altitude (m)</label>
                  <input type="number" name="rtlAltitude" value={localSettings.rtlAltitude} onChange={handleChange} className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Low Battery Threshold (%)</label>
                  <input type="number" name="lowBatteryThreshold" value={localSettings.lowBatteryThreshold} onChange={handleChange} className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">RC Loss Action</label>
                  <select name="rcLossAction" value={localSettings.rcLossAction} onChange={handleChange} className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm">
                    <option value="RTL">Return to Launch</option>
                    <option value="Loiter">Loiter (Hover)</option>
                    <option value="Land">Land</option>
                  </select>
                </div>
              </div>
            )}

            {activeTab === 'Mission' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Takeoff Altitude (m)</label>
                  <input type="number" name="takeoffAltitude" step="0.5" value={localSettings.takeoffAltitude} onChange={handleChange} className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Global Cruise Speed (m/s)</label>
                  <input type="number" name="cruiseSpeed" step="0.5" value={localSettings.cruiseSpeed} onChange={handleChange} className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Waypoint Hover Time (s)</label>
                  <input type="number" name="hoverTime" step="1" value={localSettings.hoverTime} onChange={handleChange} className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex justify-end gap-3 shrink-0 bg-slate-50">
          <button
            onClick={onClose}
            className="bg-white border border-slate-200 text-slate-600 px-5 py-2.5 rounded-lg font-bold text-xs hover:bg-slate-50 transition uppercase tracking-wider"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-lg font-bold text-xs hover:bg-blue-700 transition shadow-lg shadow-blue-200 uppercase tracking-wider"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
