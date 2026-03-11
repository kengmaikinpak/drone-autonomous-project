import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import ROSLIB from 'roslib';
import type { RosContextType, ConnectionStatus, DroneState, GpsData, HealthStatus } from '@/types';

const defaultRosContext: RosContextType = {
  connectionStatus: 'connecting',
  droneState: { mode: 'Waiting...', armed: false },
  gpsData: { latitude: 0, longitude: 0, status: -1 },
  altitude: 0,
  speed: 0,
  battery: -1,
  heading: 0,
  healthStatus: { gps: false, wifi: false, arm: false, gcs: false, fcu: false },
  homePosition: null,
  startMission: async () => ({ success: false, message: 'Not connected' }),
  landDrone: () => {},
  rosIp: 'localhost:9090',
  setRosIp: () => {},
};

const RosContext = createContext<RosContextType>(defaultRosContext);

export const useRos = () => useContext(RosContext);

interface Props {
  children: React.ReactNode;
}

export const RosProvider: React.FC<Props> = ({ children }) => {
  const rosRef = useRef<ROSLIB.Ros | null>(null);
  const [rosIp, setRosIpState] = useState(() => localStorage.getItem('ros_ip') || 'localhost:9090');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [droneState, setDroneState] = useState<DroneState>({ mode: 'Waiting...', armed: false });
  const [gpsData, setGpsData] = useState<GpsData>({ latitude: 0, longitude: 0, status: -1 });
  const [altitude, setAltitude] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [battery, setBattery] = useState(-1);
  const [heading, setHeading] = useState(0);
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    gps: false, wifi: false, arm: false, gcs: false, fcu: false,
  });
  const [homePosition, setHomePosition] = useState<{ lat: number; lng: number } | null>(null);

  const updateHealth = useCallback((key: keyof HealthStatus, value: boolean) => {
    setHealthStatus(prev => ({ ...prev, [key]: value }));
  }, []);

  const setRosIp = useCallback((ip: string) => {
    localStorage.setItem('ros_ip', ip);
    setRosIpState(ip);
  }, []);

  useEffect(() => {
    setConnectionStatus('connecting');
    const url = rosIp.startsWith('ws://') || rosIp.startsWith('wss://') ? rosIp : `ws://${rosIp}`;
    const ros = new ROSLIB.Ros({ url });
    rosRef.current = ros;

    ros.on('connection', () => {
      setConnectionStatus('connected');
      updateHealth('fcu', true);
      setTimeout(() => {
        updateHealth('wifi', true);
        updateHealth('gcs', true);
      }, 1000);
    });

    ros.on('error', () => {
      setConnectionStatus('error');
      updateHealth('fcu', false);
    });

    ros.on('close', () => {
      setConnectionStatus('closed');
      updateHealth('fcu', false);
    });

    // State subscriber
    const stateSub = new ROSLIB.Topic({
      ros, name: '/mavros/state', messageType: 'mavros_msgs/msg/State',
    });
    stateSub.subscribe((msg: any) => {
      setDroneState({ mode: msg.mode, armed: msg.armed });
      updateHealth('arm', msg.armed);
    });

    // GPS subscriber
    const gpsSub = new ROSLIB.Topic({
      ros, name: '/mavros/global_position/global', messageType: 'sensor_msgs/msg/NavSatFix',
    });
    gpsSub.subscribe((msg: any) => {
      if (msg.latitude && msg.longitude) {
        setGpsData({ latitude: msg.latitude, longitude: msg.longitude, status: msg.status?.status ?? -1 });
        updateHealth('gps', (msg.status?.status ?? -1) >= 0);
        setHomePosition(prev => prev || { lat: msg.latitude, lng: msg.longitude });
      }
    });

    // Altitude subscriber
    const altSub = new ROSLIB.Topic({
      ros, name: '/mavros/global_position/rel_alt', messageType: 'std_msgs/msg/Float64',
    });
    altSub.subscribe((msg: any) => {
      setAltitude(msg.data);
    });

    // Speed subscriber
    const vfrSub = new ROSLIB.Topic({
      ros, name: '/mavros/vfr_hud', messageType: 'mavros_msgs/msg/VFR_HUD',
    });
    vfrSub.subscribe((msg: any) => {
      setSpeed(Math.round(msg.groundspeed * 3.6));
    });

    // Battery subscriber
    const batSub = new ROSLIB.Topic({
      ros, name: '/mavros/battery', messageType: 'sensor_msgs/msg/BatteryState',
    });
    batSub.subscribe((msg: any) => {
      let pct = msg.percentage;
      if (pct > 1.0) pct /= 100.0;
      setBattery(Math.round(pct * 100));
    });

    // Compass heading subscriber
    const compassSub = new ROSLIB.Topic({
      ros, name: '/mavros/global_position/compass_hdg', messageType: 'std_msgs/msg/Float64',
    });
    compassSub.subscribe((msg: any) => {
      setHeading(msg.data);
    });

    return () => {
      stateSub.unsubscribe();
      gpsSub.unsubscribe();
      altSub.unsubscribe();
      vfrSub.unsubscribe();
      batSub.unsubscribe();
      compassSub.unsubscribe();
      ros.close();
    };
  }, [rosIp, updateHealth]);

  const startMission = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    if (!rosRef.current) return { success: false, message: 'Not connected' };
    const client = new ROSLIB.Service({
      ros: rosRef.current, name: '/mission/start', serviceType: 'std_srvs/Trigger',
    });
    return new Promise((resolve) => {
      client.callService(new ROSLIB.ServiceRequest({}), (result: any) => {
        resolve({ success: result.success, message: result.message || '' });
      }, (err: string) => {
        resolve({ success: false, message: err });
      });
    });
  }, []);

  const landDrone = useCallback(() => {
    if (!rosRef.current) return;
    const client = new ROSLIB.Service({
      ros: rosRef.current, name: '/mavros/cmd/land', serviceType: 'mavros_msgs/srv/CommandTOL',
    });
    client.callService(new ROSLIB.ServiceRequest({}), (res: any) => {
      console.log('Land Command Sent', res);
    });
  }, []);

  const value: RosContextType = {
    connectionStatus,
    droneState,
    gpsData,
    altitude,
    speed,
    battery,
    heading,
    healthStatus,
    homePosition,
    startMission,
    landDrone,
    rosIp,
    setRosIp,
  };

  return <RosContext.Provider value={value}>{children}</RosContext.Provider>;
};
