import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Gauge, ArrowUp, Clock, Battery as BatteryIcon, Target, X, Trash2,
  Home, Plane, MapPin, Settings, PlaneTakeoff,
} from 'lucide-react';
import { useRos } from '@/contexts/RosContext';
import { useMission } from '@/contexts/MissionContext';
import DroneMap from '@/components/DroneMap';
import HealthIndicators from '@/components/HealthIndicators';
import SettingsModal from '@/components/SettingsModal';
import { MapProvider, useMap } from '@/contexts/MapContext';
import { useSettings } from '@/contexts/SettingsContext';
import SlideConfirmModal from '@/components/SlideConfirmModal';
import MissionCompleteModal from '@/components/MissionCompleteModal';

type ActionType = 'START' | 'CANCEL' | 'LAND' | 'RTL' | 'CONFIRM_WAYPOINT' | null;

const actionDetails = {
  START: { title: 'START MISSION', desc: 'Send waypoints and begin offboard flight.' },
  CANCEL: { title: 'CANCEL MISSION', desc: 'Stop the drone immediately and loiter.' },
  LAND: { title: 'AUTO LAND', desc: 'Command the drone to land at its current position.' },
  RTL: { title: 'RTL', desc: 'Return to the home position of the vehicle.' },
  CONFIRM_WAYPOINT: { title: 'GO TO WAYPOINT', desc: 'Confirm to proceed to the first waypoint.' },
};

// Inner component that uses MapContext
const MissionPlannerInner: React.FC = () => {
  const {
    connectionStatus, droneState, gpsData, altitude, speed, battery,
    homePosition, startMission, confirmWaypoint, landDrone, cancelMission, returnToHome, flightTime, sendSettingsToROS
  } = useRos();
  const {
    waypoints, missionStatus, missionStatusClass, addWaypoint, removeWaypoint,
    clearWaypoints, updateWaypointAlt, sendMissionToROS, setMissionStatus,
    defaultAltitude, setDefaultAltitude,
  } = useMission();
  const { settings } = useSettings();
  const { map } = useMap();

  const [missionMode, setMissionMode] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionType>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [hasArmed, setHasArmed] = useState(false);
  const prevArmedRef = useRef(false);

  // Detect disarm => mission complete/cancelled
  useEffect(() => {
    if (droneState.armed) {
      setHasArmed(true);
      prevArmedRef.current = true;
    }
    if (!droneState.armed && prevArmedRef.current && hasArmed) {
      if (isRunning) {
        setShowModal(true);
      }
      setIsRunning(false);
      setMissionStatus('READY', 'text-green-500');
      prevArmedRef.current = false;
      setHasArmed(false);
    }
  }, [droneState.armed, hasArmed, isRunning, setMissionStatus]);

  const connLabel =
    connectionStatus === 'connected' ? 'Online' :
      connectionStatus === 'error' ? 'Error' :
        connectionStatus === 'closed' ? 'Offline' : 'Connecting...';
  const connColor =
    connectionStatus === 'connected' ? 'text-green-500 bg-green-500' :
      connectionStatus === 'error' ? 'text-red-500 bg-red-500' : 'text-slate-400 bg-slate-400';
  const connParts = connColor.split(' ');

  const toggleMissionMode = useCallback(() => {
    setMissionMode(prev => !prev);
  }, []);

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (missionMode) {
      addWaypoint(lat, lng, defaultAltitude);
    }
  }, [missionMode, addWaypoint, defaultAltitude]);

  const handleConfirmMission = useCallback(() => {
    sendMissionToROS();
    setMissionMode(false);
  }, [sendMissionToROS]);

  const handleClearWaypoints = useCallback(() => {
    clearWaypoints();
  }, [clearWaypoints]);

  const handleStartMission = useCallback(() => setPendingAction('START'), []);
  const handleLand = useCallback(() => setPendingAction('LAND'), []);
  const handleCancelMission = useCallback(() => setPendingAction('CANCEL'), []);
  const handleReturnToHome = useCallback(() => setPendingAction('RTL'), []);

  const executeAction = useCallback(async () => {
    const action = pendingAction;
    setPendingAction(null); // Close modal immediately

    if (action === 'START') {
      setMissionStatus('SENDING...', 'text-orange-500');
      sendSettingsToROS(settings);
      const result = await startMission();
      if (result.success) {
        setIsRunning(true);
        setMissionStatus('TAKING OFF...', 'text-orange-500');
      } else {
        setMissionStatus('FAILED', 'text-red-500');
      }
    } else if (action === 'CONFIRM_WAYPOINT') {
      setMissionStatus('CONFIRMING...', 'text-orange-500');
      const result = await confirmWaypoint();
      if (result.success) {
        setMissionStatus('MISSION RUNNING', 'text-green-500');
      } else {
        setMissionStatus('FAILED', 'text-red-500');
      }
    } else if (action === 'LAND') {
      setMissionStatus('LANDING...', 'text-orange-500');
      const success = await landDrone();
      if (!success) setMissionStatus('IDLE', 'text-blue-500');
    } else if (action === 'CANCEL') {
      setMissionStatus('CANCELLING...', 'text-orange-500');
      const success = await cancelMission();
      if (success) {
        setIsRunning(false);
        setMissionStatus('IDLE', 'text-blue-500');
      } else {
        setMissionStatus('IDLE', 'text-blue-500');
      }
    } else if (action === 'RTL') {
      setMissionStatus('RETURNING...', 'text-orange-500');
      const success = await returnToHome();
      if (!success) setMissionStatus('IDLE', 'text-blue-500');
    }
  }, [pendingAction, startMission, confirmWaypoint, landDrone, cancelMission, returnToHome, setMissionStatus]);

  useEffect(() => {
    if (missionStatus === 'TAKING OFF...' && altitude >= settings.takeoffAltitude - 0.2) {
      setMissionStatus('WAITING CONFIRM', 'text-orange-500');
    }
  }, [altitude, missionStatus, setMissionStatus, settings.takeoffAltitude]);

  const centerMapOnDrone = useCallback(() => {
    if (map && gpsData.latitude && gpsData.longitude) {
      map.setView([gpsData.latitude, gpsData.longitude], 18);
    }
  }, [map, gpsData]);

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Sidebar Panel */}
      <aside className="w-80 bg-white shadow-xl z-20 flex flex-col border-r border-slate-200">
        {/* Header */}
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-700 uppercase tracking-wider">Mission Planner</span>
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            </div>
            <div className="flex items-center gap-1">
              <span className={`text-[9px] font-bold uppercase ${connParts[0]}`}>{connLabel}</span>
              <div className={`w-2 h-2 rounded-full ${connParts[1]} ${connectionStatus === 'connecting' ? 'animate-pulse' : ''}`} />
            </div>
          </div>
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest">Holybro X500 V2</p>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto sidebar-scroll p-4 space-y-6">
          {/* Status */}
          <section>
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4">Current Status</h3>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-bold flex items-center gap-1">
                  <Gauge className="w-3 h-3" /> Speed
                </p>
                <p className="text-sm font-bold text-slate-700">
                  {speed} <span className="text-[10px]">km/h</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-bold flex items-center gap-1">
                  <ArrowUp className="w-3 h-3" /> Height
                </p>
                <p className="text-sm font-bold text-slate-700">
                  {altitude.toFixed(1)} <span className="text-[10px]">m</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-bold flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Time
                </p>
                <p className="text-sm font-bold text-slate-700">{flightTime}</p>
              </div>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <div className="flex items-center gap-1">
                <BatteryIcon className="w-4 h-4 text-green-500" />
                <span className="font-bold text-green-500">{battery >= 0 ? `${battery}%` : '--%'}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-slate-400 uppercase font-bold">Mode:</span>
                <span className={`font-bold uppercase ${droneState.mode === 'OFFBOARD' ? 'text-green-500' : 'text-blue-500'}`}>
                  {droneState.mode}
                </span>
              </div>
            </div>
          </section>

          {/* Health */}
          <section>
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4 border-t pt-4">Drone Health</h3>
            <HealthIndicators />
          </section>

          {/* Mission Status */}
          <section>
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 border-t pt-4">Mission Status</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-400 font-bold uppercase tracking-wider">Status</span>
                <span className={`font-bold ${missionStatusClass}`}>{missionStatus}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-400 font-bold uppercase tracking-wider">Distance from base</span>
                <span className="text-slate-700 font-bold">0.0 KM</span>
              </div>
            </div>
          </section>

          {/* Controls */}
          <div className="pt-4 space-y-2">
            {missionStatus === 'WAITING CONFIRM' ? (
              <button
                onClick={() => setPendingAction('CONFIRM_WAYPOINT')}
                className="w-full bg-orange-500 text-white py-3 rounded-xl font-bold text-xs hover:bg-orange-600 transition shadow-lg shadow-orange-200 uppercase tracking-widest"
              >
                GO TO WAYPOINT
              </button>
            ) : (
              <button
                onClick={handleStartMission}
                disabled={connectionStatus !== 'connected' || isRunning}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold text-xs hover:bg-blue-700 transition shadow-lg shadow-blue-200 uppercase tracking-widest disabled:bg-slate-300 disabled:shadow-none"
              >
                {missionStatus === 'TAKING OFF...' ? 'TAKING OFF...' : (isRunning ? 'MISSION RUNNING' : 'START MISSION')}
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleCancelMission}
                className="bg-red-50 border border-red-500 text-red-500 py-2 rounded-lg font-bold text-[10px] hover:bg-red-100 uppercase tracking-widest transition"
              >
                Cancel Mission
              </button>
              <button
                onClick={handleLand}
                className="bg-slate-100 border border-slate-300 text-slate-600 py-2 rounded-lg font-bold text-[10px] hover:bg-slate-200 uppercase tracking-widest transition"
              >
                Auto Land
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex justify-between items-center">
          <div className="flex gap-6">
            <button
              onClick={handleReturnToHome}
              className="btn-circle tooltip-left bg-blue-50 text-blue-600 hover:bg-blue-100 group"
            >
              <Home className="w-4 h-4" />
              <div className="tooltip-text">
                Return to Home
                <div className="tooltip-arrow" />
              </div>
            </button>
            <button
              onClick={centerMapOnDrone}
              className="btn-circle bg-slate-50 text-slate-400 hover:bg-slate-100 group"
            >
              <Plane className="w-4 h-4" />
              <div className="tooltip-text">
                Center Drone
                <div className="tooltip-arrow" />
              </div>
            </button>
            <button className="btn-circle bg-slate-50 text-slate-400 hover:bg-slate-100 group">
              <MapPin className="w-4 h-4" />
              <div className="tooltip-text">
                Target Location
                <div className="tooltip-arrow" />
              </div>
            </button>
          </div>
          <button
            className="text-slate-400 hover:text-blue-500"
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content (Map) */}
      <main className="flex-1 relative">
        {/* Top bar */}
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 bg-white/90 backdrop-blur-sm px-6 py-2 rounded-full shadow-lg border border-white flex gap-10 items-center">
          <button className="text-[11px] font-bold text-blue-500 flex flex-col items-center gap-1 group">
            <PlaneTakeoff className="w-4 h-4" />
            <span className="tracking-widest uppercase">Drones</span>
          </button>
          <button
            onClick={toggleMissionMode}
            className={`text-[11px] font-bold flex flex-col items-center gap-1 transition uppercase tracking-widest ${missionMode ? 'text-blue-500' : 'text-slate-400 hover:text-slate-600'
              }`}
          >
            <Target className="w-4 h-4" />
            Mission
          </button>
        </div>

        <div className="w-full h-full">
          <DroneMap
            interactive={true}
            onMapClick={handleMapClick}
            cursorStyle={missionMode ? 'crosshair' : undefined}
          />
        </div>

        {/* Mission Panel Overlay */}
        {missionMode && (
          <div className="absolute top-20 right-6 z-20 bg-white/95 backdrop-blur-sm rounded-xl shadow-md border border-slate-200 w-96 overflow-hidden">
            <div className="p-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  <span className="font-bold text-sm uppercase tracking-wider">Mission Planner</span>
                </div>
                <button onClick={toggleMissionMode} className="hover:bg-white/20 rounded p-1 transition">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[10px] text-blue-100 mt-1">Click on the map to add a waypoint.</p>
            </div>

            <div className="p-3 max-h-64 overflow-y-auto sidebar-scroll">
              <div className="space-y-2">
                {waypoints.length === 0 ? (
                  <p className="text-[11px] text-slate-400 text-center py-4">No Waypoint</p>
                ) : (
                  waypoints.map((wp, i) => (
                    <div key={i} className="flex items-center justify-between bg-slate-50 rounded-lg p-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-[10px] font-bold">
                          {i + 1}
                        </span>
                        <div>
                          <p className="text-[10px] font-bold text-slate-700">
                            {wp.lat.toFixed(6)}, {wp.lng.toFixed(6)}
                          </p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-[9px] text-slate-400">Alt:</span>
                            <input
                              type="number"
                              value={wp.altitude}
                              onChange={(e) => updateWaypointAlt(i, parseFloat(e.target.value))}
                              className="w-12 text-[10px] border border-slate-200 rounded px-1 py-0.5 text-center font-bold text-slate-600 bg-white focus:outline-none focus:border-blue-400"
                              step={0.5}
                            />
                            <span className="text-[9px] text-slate-400">m</span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeWaypoint(i)}
                        className="text-red-400 hover:text-red-600 p-1 transition"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="px-3 py-2 border-t border-slate-100 flex items-center justify-between bg-slate-50">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Default Altitude</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={defaultAltitude}
                  onChange={(e) => setDefaultAltitude(parseFloat(e.target.value) || 3.0)}
                  step={0.5}
                  min={0.5}
                  className="w-14 text-[10px] border border-slate-300 rounded px-1 py-1 text-center font-bold text-slate-700 focus:outline-none focus:border-blue-500 bg-white"
                />
                <span className="text-[10px] font-bold text-slate-500">m</span>
              </div>
            </div>

            <div className="p-3 border-t border-slate-100 space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={handleClearWaypoints}
                  className="flex-1 bg-slate-100 text-slate-600 py-2 rounded-lg font-bold text-[10px] hover:bg-slate-200 transition uppercase tracking-wider"
                >
                  Clear All
                </button>
                <button
                  onClick={handleConfirmMission}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold text-[10px] hover:bg-blue-700 transition uppercase tracking-wider shadow-lg shadow-blue-200"
                >
                  Confirm
                </button>
              </div>
              <p className="text-[10px] text-slate-400 text-center">{waypoints.length} Waypoints</p>
            </div>
          </div>
        )}

        {/* Coordinates overlay */}
        <div className="absolute bottom-6 right-6 z-10 space-y-2">
          <div className="bg-white/90 backdrop-blur-sm p-3 rounded-xl shadow-lg border border-white flex flex-col gap-1 items-end">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Coordinate</span>
            <span className="text-[11px] font-mono font-bold text-slate-700">
              {gpsData.latitude.toFixed(4)}, {gpsData.longitude.toFixed(4)}
            </span>
          </div>
        </div>

        {/* Slide to Confirm Action Modal (Centered on Map) */}
        <SlideConfirmModal
          isOpen={pendingAction !== null}
          title={pendingAction ? actionDetails[pendingAction].title : ''}
          description={pendingAction ? actionDetails[pendingAction].desc : ''}
          onConfirm={executeAction}
          onCancel={() => setPendingAction(null)}
        />
      </main>

      {/* Mission Complete Modal */}
      <MissionCompleteModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};

// Wrapper with MapProvider
const MissionPlannerPage: React.FC = () => (
  <MapProvider>
    <MissionPlannerInner />
  </MapProvider>
);

export default MissionPlannerPage;
