import React, { useState, useEffect } from 'react';
import { X, Network } from 'lucide-react';
import { useRos } from '@/contexts/RosContext';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { rosIp, setRosIp } = useRos();
  const [ipInput, setIpInput] = useState(rosIp);

  useEffect(() => {
    if (isOpen) {
      setIpInput(rosIp);
    }
  }, [isOpen, rosIp]);

  const handleSave = () => {
    setRosIp(ipInput);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-[450px] overflow-hidden border border-slate-200">
        <div className="p-4 bg-slate-800 text-white flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-blue-400" />
            <h2 className="font-bold text-lg tracking-wider">Settings</h2>
          </div>
          <button onClick={onClose} className="hover:bg-white/20 p-1 rounded transition text-slate-300 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-6">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              ROS Connection Address
            </label>
            <input
              type="text"
              value={ipInput}
              onChange={(e) => setIpInput(e.target.value)}
              placeholder="e.g., localhost:9090 or 192.168.1.100:9090"
              className="w-full bg-slate-50 border border-slate-300 text-slate-700 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition font-mono text-sm"
              autoFocus
            />
            <p className="text-[10px] text-slate-400 mt-2">
              Enter the IP address and port of your ROS bridge server. The connection will automatically restart on save.
            </p>
          </div>

          <div className="flex gap-3 justify-end">
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
              Save & Reconnect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
