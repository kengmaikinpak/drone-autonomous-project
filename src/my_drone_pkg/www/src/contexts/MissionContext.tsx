import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import ROSLIB from 'roslib';
import type { MissionContextType, Waypoint } from '@/types';
import { useRos } from '@/contexts/RosContext';

const defaultMissionContext: MissionContextType = {
  waypoints: [],
  missionStatus: 'IDLE',
  missionStatusClass: 'text-blue-500',
  addWaypoint: () => {},
  removeWaypoint: () => {},
  clearWaypoints: () => {},
  updateWaypointAlt: () => {},
  sendMissionToROS: () => {},
  setMissionStatus: () => {},
  defaultAltitude: 3.0,
  setDefaultAltitude: () => {},
};

const MissionContext = createContext<MissionContextType>(defaultMissionContext);

export const useMission = () => useContext(MissionContext);

interface Props {
  children: React.ReactNode;
  rosUrl?: string;
}

/**
 * แปลง lat/lng → Local ENU (เมตร) โดยอ้างอิงจาก origin ที่ระบุ
 * origin คือ homePosition (GPS fix แรก) ซึ่งตรงกับตอนที่ MAVROS สร้าง Local Frame
 */
function latlngToENU(lat: number, lng: number, originLat: number, originLng: number) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos(originLat * Math.PI / 180);
  return {
    x: (lng - originLng) * metersPerDegreeLng,  // ENU: East → +X
    y: (lat - originLat) * metersPerDegreeLat,  // ENU: North → +Y
  };
}

export const MissionProvider: React.FC<Props> = ({ children, rosUrl = 'ws://localhost:9090' }) => {
  const [waypoints, setWaypoints] = useState<Waypoint[]>(() => {
    try {
      const saved = localStorage.getItem('droneWaypoints');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [missionStatus, setMissionStatusState] = useState('IDLE');
  const [missionStatusClass, setMissionStatusClass] = useState('text-blue-500');
  const [defaultAltitude, setDefaultAltitude] = useState(3.0);

  const { gpsData, homePosition, sendWaypointsToROS } = useRos();

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('droneWaypoints', JSON.stringify(waypoints));
  }, [waypoints]);

  // Cross-tab sync
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'droneWaypoints') {
        try {
          setWaypoints(e.newValue ? JSON.parse(e.newValue) : []);
        } catch {
          console.error('Failed to sync waypoints across tabs');
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setMissionStatus = useCallback((status: string, className?: string) => {
    setMissionStatusState(status);
    if (className) setMissionStatusClass(className);
  }, []);

  const addWaypoint = useCallback((lat: number, lng: number, altitude: number) => {
    setWaypoints(prev => [...prev, { lat, lng, altitude }]);
  }, []);

  const removeWaypoint = useCallback((index: number) => {
    setWaypoints(prev => prev.filter((_, i) => i !== index));
  }, []);

  const clearWaypoints = useCallback(() => {
    setWaypoints([]);
  }, []);

  const updateWaypointAlt = useCallback((index: number, altitude: number) => {
    const alt = isNaN(altitude) || altitude <= 0 ? 3.0 : altitude;
    setWaypoints(prev => prev.map((wp, i) => i === index ? { ...wp, altitude: alt } : wp));
  }, []);

  // Already extracted useRos variables above

  const sendMissionToROS = useCallback(() => {
    if (waypoints.length === 0) {
      console.warn('No waypoints to send');
      return;
    }

    // ใช้ตำแหน่ง GPS ปัจจุบันของโดรน ณ ตอนกดส่ง เป็น ENU Origin
    // เพราะ mission_control.py ใช้ current_pose เป็นจุดเริ่มต้น
    const originLat = gpsData.latitude;
    const originLng = gpsData.longitude;

    if (!originLat || !originLng) {
      console.warn('Drone GPS not available yet. Cannot send mission.');
      setMissionStatus('GPS NOT READY', 'text-red-500');
      return;
    }

    // แปลง lat/lng → Local ENU โดยอ้างอิงจาก GPS โดรนปัจจุบัน (origin)
    const poses = waypoints.map(wp => {
      const enu = latlngToENU(wp.lat, wp.lng, originLat, originLng);
      return {
        position: { x: enu.x, y: enu.y, z: wp.altitude },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      };
    });

    sendWaypointsToROS(poses);
    
    console.log(`Mission sent (ENU origin: ${originLat.toFixed(6)}, ${originLng.toFixed(6)}):`, poses);
    setMissionStatus('WAYPOINTS SENT', 'text-green-500');
  }, [waypoints, gpsData, sendWaypointsToROS, setMissionStatus]);

  const value: MissionContextType = {
    waypoints,
    missionStatus,
    missionStatusClass,
    addWaypoint,
    removeWaypoint,
    clearWaypoints,
    updateWaypointAlt,
    sendMissionToROS,
    setMissionStatus,
    defaultAltitude,
    setDefaultAltitude,
  };

  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>;
};
