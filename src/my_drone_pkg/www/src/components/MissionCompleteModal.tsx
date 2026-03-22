import React from 'react';
import { X } from 'lucide-react';
import { useMission } from '@/contexts/MissionContext';

interface MissionCompleteModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MissionCompleteModal: React.FC<MissionCompleteModalProps> = ({ isOpen, onClose }) => {
  const { clearWaypoints } = useMission();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50">
      <div className="bg-white rounded-xl shadow-2xl w-[400px] overflow-hidden">
        <div className="p-4 bg-blue-600 text-white flex justify-between items-center">
          <h2 className="font-bold text-lg tracking-wider">Flight Plan complete</h2>
          <button onClick={onClose} className="hover:bg-white/20 p-1 rounded transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 flex flex-col gap-3">
          <button
            onClick={() => { clearWaypoints(); onClose(); }}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-lg font-bold text-sm transition border border-slate-300 shadow-sm"
          >
            Remove plan from vehicle
          </button>
          <button
            onClick={onClose}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-lg font-bold text-sm transition border border-slate-300 shadow-sm"
          >
            Leave plan on vehicle
          </button>
          <hr className="my-3 border-slate-200" />
          <button
            onClick={onClose}
            className="w-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 py-3 rounded-lg font-bold text-sm transition shadow-sm"
          >
            Resume Mission From Waypoint 1
          </button>
          <p className="text-[11px] text-slate-500 mt-2 leading-relaxed font-medium">
            Resume Mission will rebuild the current mission from the last flown waypoint and upload it to the vehicle for the next flight.
          </p>
          <p className="text-[11px] text-red-500 font-bold mt-1">
            If you are changing batteries for Resume Mission do not disconnect from the vehicle.
          </p>
        </div>
      </div>
    </div>
  );
};

export default MissionCompleteModal;
