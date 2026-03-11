import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  MapPin, Zap, Clock, Battery, Cpu, Target, Activity,
  Crosshair, Layers, MoreHorizontal, Home,
} from 'lucide-react';
import { useRos } from '@/contexts/RosContext';
import { useMission } from '@/contexts/MissionContext';
import DroneMap from '@/components/DroneMap';
import HealthIndicators from '@/components/HealthIndicators';
import { MapProvider } from '@/contexts/MapContext';

const DashboardPage: React.FC = () => {
  const {
    connectionStatus, droneState, gpsData, altitude, speed, battery,
    homePosition, startMission, landDrone,
  } = useRos();
  const { waypoints, missionStatus, missionStatusClass, setMissionStatus } = useMission();

  const [isRunning, setIsRunning] = useState(false);
  const [hasArmed, setHasArmed] = useState(false);
  const prevArmedRef = useRef(false);

  // Flight timer
  const [flightTime, setFlightTime] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (droneState.armed && !timerRef.current) {
      timerRef.current = setInterval(() => setFlightTime(t => t + 1), 1000);
    }
    if (!droneState.armed && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [droneState.armed]);

  // Detect disarm => mission complete
  useEffect(() => {
    if (droneState.armed) {
      setHasArmed(true);
      prevArmedRef.current = true;
    }
    if (!droneState.armed && prevArmedRef.current && hasArmed) {
      setIsRunning(false);
      setMissionStatus('READY', 'text-slate-500');
      prevArmedRef.current = false;
      setHasArmed(false);
    }
  }, [droneState.armed, hasArmed, setMissionStatus]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const handleStartMission = useCallback(async () => {
    setMissionStatus('SENDING...', 'text-orange-500');
    const result = await startMission();
    if (result.success) {
      setIsRunning(true);
      setMissionStatus('STARTED', 'text-green-500');
    } else {
      setMissionStatus('FAILED', 'text-red-500');
    }
  }, [startMission, setMissionStatus]);

  const handleLand = useCallback(() => {
    setMissionStatus('CANCELLING...', 'text-orange-500');
    landDrone();
  }, [landDrone, setMissionStatus]);

  const connLabel =
    connectionStatus === 'connected' ? 'Online' :
    connectionStatus === 'error' ? 'Error' :
    connectionStatus === 'closed' ? 'Offline' : 'Connecting...';

  const connColor =
    connectionStatus === 'connected' ? 'text-green-500' :
    connectionStatus === 'error' ? 'text-red-500' : 'text-slate-400';

  return (
    <MapProvider>
      <main className="flex-1 p-4 overflow-hidden" style={{ background: 'linear-gradient(135deg, #f1f5f9, #e2e8f0)' }}>
        <div
          className="h-full"
          style={{
            display: 'grid',
            gridTemplateColumns: '260px 1fr 340px',
            gridTemplateRows: 'auto 1fr',
            gap: '1rem',
          }}
        >
          {/* TOP ROW - Metrics */}
          <div className="col-span-3 grid grid-cols-4 gap-4 h-28 mb-2">
            {/* GPS Card */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">GPS Coordinates</h4>
                <div className="p-1.5 bg-blue-50 rounded-lg text-blue-500">
                  <MapPin className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div className="text-xl font-bold text-slate-800 font-mono tracking-tight">
                  {gpsData.latitude.toFixed(4)}, {gpsData.longitude.toFixed(4)}
                </div>
                <div className="text-[10px] font-bold text-slate-400 mt-1 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  Precision: {altitude.toFixed(1)} m (Alt)
                </div>
              </div>
            </div>

            {/* Speed Card */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ground Speed</h4>
                <div className="p-1.5 bg-purple-50 rounded-lg text-purple-500">
                  <Zap className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-800">
                  {speed} <span className="text-sm text-slate-400">km/h</span>
                </div>
                <div className="text-[10px] font-bold text-slate-400 mt-1">Stable Flight</div>
              </div>
            </div>

            {/* Flight Time Card */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Flight Time</h4>
                <div className="p-1.5 bg-orange-50 rounded-lg text-orange-500">
                  <Clock className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-800">{formatTime(flightTime)}</div>
                <div className="text-[10px] font-bold text-slate-400 mt-1">Session Active</div>
              </div>
            </div>

            {/* Battery Card */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Battery</h4>
                <div className="p-1.5 bg-green-50 rounded-lg text-green-500">
                  <Battery className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-800">
                  {battery >= 0 ? `${battery}%` : '--%'}
                </div>
                <div className={`text-[10px] font-bold mt-1 uppercase ${connColor}`}>
                  {connLabel}
                </div>
              </div>
            </div>
          </div>

          {/* LEFT COLUMN */}
          <div className="flex flex-col gap-4 overflow-hidden">
            {/* Drone Status */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Cpu className="w-4 h-4" /> Drone Status
              </h3>
              <div className="space-y-4">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Model</div>
                  <div className="font-bold text-slate-700">Holybro X500 V2</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Mode</div>
                  <div className={`font-bold uppercase ${
                    droneState.mode === 'OFFBOARD' ? 'text-green-500' : 'text-blue-500'
                  }`}>
                    {droneState.mode}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">System Health</div>
                  <HealthIndicators compact />
                </div>
              </div>
            </div>

            {/* Mission Controls */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex-1 flex flex-col">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Target className="w-4 h-4" /> Mission Control
              </h3>

              <div className="flex-1 flex flex-col justify-center items-center text-center space-y-2 mb-4">
                <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center mx-auto mb-1">
                  <Activity className="w-6 h-6" />
                </div>
                <div className={`font-bold ${missionStatusClass}`}>{missionStatus}</div>
                <div className="text-[10px] font-bold text-slate-400">Distance: 0.00 km</div>
              </div>

              <div className="space-y-2">
                <button
                  onClick={handleStartMission}
                  disabled={connectionStatus !== 'connected' || isRunning}
                  className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold text-xs hover:bg-blue-700 transition shadow-lg shadow-blue-200 uppercase tracking-widest disabled:bg-slate-300 disabled:shadow-none"
                >
                  {isRunning ? 'MISSION RUNNING' : 'START MISSION'}
                </button>
                <button
                  onClick={handleLand}
                  className="w-full bg-red-500 text-white py-3 rounded-xl font-bold text-xs hover:bg-red-600 transition shadow-lg shadow-red-200 uppercase tracking-widest"
                >
                  Emergency Stop
                </button>
                <button
                  onClick={handleLand}
                  className="w-full bg-slate-100 text-slate-600 py-3 rounded-xl font-bold text-xs hover:bg-slate-200 transition uppercase tracking-widest"
                >
                  Return to Land
                </button>
              </div>
            </div>
          </div>

          {/* CENTER - Map */}
          <div className="bg-white rounded-2xl p-2 shadow-sm border border-slate-100 relative overflow-hidden">
            <DroneMap className="rounded-xl" />
            <div className="absolute bottom-6 right-6 z-20 flex gap-2">
              <button className="p-2 bg-white rounded-lg shadow-md text-slate-500 hover:text-blue-500 hover:bg-blue-50 transition">
                <Crosshair className="w-5 h-5" />
              </button>
              <button className="p-2 bg-white rounded-lg shadow-md text-slate-500 hover:text-blue-500 hover:bg-blue-50 transition">
                <Layers className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="flex flex-col gap-4 overflow-hidden">
            {/* Altitude Chart */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 h-1/3 flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Altitude Log</h3>
                <button className="text-slate-400 hover:text-blue-500">
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 bg-gradient-to-b from-blue-50 to-transparent rounded-xl border border-blue-100 flex items-center justify-center relative overflow-hidden">
                <svg className="absolute bottom-0 left-0 w-full h-1/2" viewBox="0 0 100 50" preserveAspectRatio="none">
                  <path d="M0,50 L0,40 C20,20 40,60 60,30 C80,0 100,20 100,10 L100,50 Z" className="fill-blue-200 opacity-50" />
                  <path d="M0,50 L0,35 C20,25 40,50 60,35 C80,10 100,15 100,5 L100,50 Z" className="fill-blue-500 opacity-20" />
                </svg>
                <span className="text-xs font-bold text-blue-300 relative z-10">Chart Visualization</span>
              </div>
            </div>

            {/* Mission Queue */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex-1 flex flex-col overflow-hidden">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Mission Queue</h3>
              <div className="flex-1 overflow-y-auto pr-2 space-y-3 sidebar-scroll">
                {waypoints.length === 0 ? (
                  <div className="text-[11px] text-slate-400 text-center py-4">No Active Missions</div>
                ) : (
                  <>
                    {homePosition && (
                      <div className="flex items-center justify-between p-3 border border-slate-100 rounded-xl bg-slate-50 opacity-80">
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-[10px] font-bold">
                            <Home className="w-3 h-3" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-slate-600">Home Position</span>
                            <span className="text-[9px] font-bold text-slate-400">
                              Lat: {homePosition.lat.toFixed(4)}, Lng: {homePosition.lng.toFixed(4)}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-slate-500">Takeoff</span>
                      </div>
                    )}
                    {waypoints.map((wp, i) => (
                      <div
                        key={i}
                        className={`flex items-center justify-between p-3 border border-slate-100 rounded-xl hover:border-blue-200 transition group cursor-pointer ${
                          i === 0 ? 'bg-slate-50' : 'bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            i === 0 ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'
                          }`}>
                            {i + 1}
                          </div>
                          <div className="flex flex-col">
                            <span className={`text-xs font-bold ${i === 0 ? 'text-slate-700' : 'text-slate-600'}`}>
                              Waypoint {i + 1}
                            </span>
                            <span className="text-[9px] font-bold text-slate-400">
                              Lat: {wp.lat.toFixed(4)}, Lng: {wp.lng.toFixed(4)} • Alt: {wp.altitude}m
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-slate-500">
                          {i === 0 ? 'Next' : 'Pending'}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </MapProvider>
  );
};

export default DashboardPage;
