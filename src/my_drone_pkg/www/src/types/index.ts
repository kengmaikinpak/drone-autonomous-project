// ===================================================
// Type Definitions for Drone Dashboard
// ===================================================

export interface Waypoint {
  lat: number;
  lng: number;
  altitude: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'error' | 'closed';

export interface DroneState {
  mode: string;
  armed: boolean;
}

export interface GpsData {
  latitude: number;
  longitude: number;
  status: number;
}

export interface HealthStatus {
  gps: boolean;
  wifi: boolean;
  arm: boolean;
  gcs: boolean;
  fcu: boolean;
}

export interface RosContextType {
  connectionStatus: ConnectionStatus;
  droneState: DroneState;
  gpsData: GpsData;
  altitude: number;
  speed: number;
  battery: number;
  heading: number;
  flightTime: string;
  healthStatus: HealthStatus;
  homePosition: { lat: number; lng: number } | null;
  startMission: () => Promise<{ success: boolean; message: string }>;
  landDrone: () => void;
  cancelMission: () => void;
  returnToHome: () => void;
  rosIp: string;
  setRosIp: (ip: string) => void;
}

export interface MissionContextType {
  waypoints: Waypoint[];
  missionStatus: string;
  missionStatusClass: string;
  addWaypoint: (lat: number, lng: number, altitude: number) => void;
  removeWaypoint: (index: number) => void;
  clearWaypoints: () => void;
  updateWaypointAlt: (index: number, altitude: number) => void;
  sendMissionToROS: () => void;
  setMissionStatus: (status: string, className?: string) => void;
  defaultAltitude: number;
  setDefaultAltitude: (alt: number) => void;
}

export interface MapContextType {
  map: L.Map | null;
  setMap: (map: L.Map | null) => void;
}
