import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import ROSLIB from 'roslib';
import type { MissionContextType, Waypoint } from '@/types';

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
  const rosRef = useRef<ROSLIB.Ros | null>(null);

  // Lazy ROS connection for publishing
  const getRos = useCallback(() => {
    if (!rosRef.current) {
      rosRef.current = new ROSLIB.Ros({ url: rosUrl });
    }
    return rosRef.current;
  }, [rosUrl]);

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

  const sendMissionToROS = useCallback(() => {
    if (waypoints.length === 0) {
      console.warn('No waypoints to send');
      return;
    }

    const ros = getRos();
    const topic = new ROSLIB.Topic({
      ros,
      name: '/mission/waypoints',
      messageType: 'geometry_msgs/msg/PoseArray',
    });

    // Convert lat/lng to local ENU coords relative to first waypoint
    const baseLat = waypoints[0].lat;
    const baseLng = waypoints[0].lng;
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos(baseLat * Math.PI / 180);

    const poses = waypoints.map(wp => ({
      position: {
        x: (wp.lng - baseLng) * metersPerDegreeLng,
        y: (wp.lat - baseLat) * metersPerDegreeLat,
        z: wp.altitude,
      },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    }));

    const msg = new ROSLIB.Message({
      header: { stamp: { sec: 0, nanosec: 0 }, frame_id: 'map' },
      poses,
    });

    topic.publish(msg);
    console.log('Mission waypoints sent to ROS:', poses);
    setMissionStatus('WAYPOINTS SENT', 'text-green-500');
  }, [waypoints, getRos, setMissionStatus]);

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
