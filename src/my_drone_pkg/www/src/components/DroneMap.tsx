import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useRos } from '@/contexts/RosContext';
import { useMission } from '@/contexts/MissionContext';
import { useMap } from '@/contexts/MapContext';

const DRONE_ICON_HTML = `
<div class="relative">
    <div class="absolute -top-5 -left-5 w-10 h-10 bg-blue-500 rounded-tl-full rounded-bl-full rounded-br-full rounded-tr-[200rem] border-2 border-white shadow-xl flex items-center justify-center">
        <svg style="transform: rotate(45deg);" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 10 7 7"/><path d="m10 14-3 3"/><path d="m14 10 3-3"/><path d="m14 14 3 3"/>
            <path d="M14.205 4.139a4 4 0 1 1 5.439 5.863"/><path d="M19.637 14a4 4 0 1 1-5.432 5.868"/>
            <path d="M4.367 10a4 4 0 1 1 5.438-5.862"/><path d="M9.795 19.862a4 4 0 1 1-5.429-5.873"/>
            <rect x="10" y="8" width="4" height="8" rx="1"/>
        </svg>
    </div>
</div>`;

const HOME_ICON_HTML = `
<div class="relative">
  <div class="absolute -top-5 -left-5 w-10 h-10 bg-green-500 rounded-full border-2 border-white shadow-xl flex items-center justify-center text-white">
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
      <polyline points="9 22 9 12 15 12 15 22"></polyline>
    </svg>
  </div>
</div>`;

function createWaypointIcon(number: number): L.DivIcon {
  return L.divIcon({
    html: `
      <div class="relative">
        <div class="absolute -top-5 -left-5 w-10 h-10 bg-orange-500 rounded-full border-2 border-white shadow-xl flex items-center justify-center text-white font-bold text-sm">
          ${number}
        </div>
      </div>`,
    className: 'waypoint-marker',
  });
}

interface DroneMapProps {
  className?: string;
  onMapClick?: (lat: number, lng: number) => void;
  showWaypoints?: boolean;
  interactive?: boolean;
  cursorStyle?: string;
}

const DroneMap: React.FC<DroneMapProps> = ({
  className = '',
  onMapClick,
  showWaypoints = true,
  interactive = false,
  cursorStyle,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const droneMarkerRef = useRef<L.Marker | null>(null);
  const homeMarkerRef = useRef<L.Marker | null>(null);
  const waypointMarkersRef = useRef<L.Marker[]>([]);
  const waypointLinesRef = useRef<L.Polyline | null>(null);
  const onMapClickRef = useRef(onMapClick);

  const { gpsData, heading, homePosition } = useRos();
  const { waypoints } = useMission();
  const { setMap } = useMap();

  // Always keep the ref up to date with the latest callback
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([14.039498, 100.606766], 15);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
    }).addTo(map);

    const droneIcon = L.divIcon({
      html: DRONE_ICON_HTML,
      className: 'custom-div-icon',
    });

    const marker = L.marker([14.039498, 100.606766], { 
      icon: droneIcon,
      zIndexOffset: 1000 // ให้โดรนอยู่บนสุดเสมอ
    }).addTo(map);
    droneMarkerRef.current = marker;
    mapInstanceRef.current = map;
    setMap(map);

    if (interactive) {
      map.on('click', (e: L.LeafletMouseEvent) => {
        // Use the ref so we always call the latest callback
        onMapClickRef.current?.(e.latlng.lat, e.latlng.lng);
      });
    }

    // Fix map sizing
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      droneMarkerRef.current = null;
      homeMarkerRef.current = null;
      waypointMarkersRef.current = [];
      waypointLinesRef.current = null;
      setMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update cursor style on the map container
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const container = mapInstanceRef.current.getContainer();
    container.style.cursor = cursorStyle || '';
  }, [cursorStyle]);

  // Update drone position
  useEffect(() => {
    if (!droneMarkerRef.current || !mapInstanceRef.current) return;
    if (gpsData.latitude && gpsData.longitude) {
      droneMarkerRef.current.setLatLng([gpsData.latitude, gpsData.longitude]);
      mapInstanceRef.current.panTo([gpsData.latitude, gpsData.longitude]);
    }
  }, [gpsData.latitude, gpsData.longitude]);

  // Update home position marker
  useEffect(() => {
    if (!mapInstanceRef.current || !homePosition) return;
    const map = mapInstanceRef.current;

    if (!homeMarkerRef.current) {
      const homeIcon = L.divIcon({
        html: HOME_ICON_HTML,
        className: 'custom-div-icon',
      });
      homeMarkerRef.current = L.marker([homePosition.lat, homePosition.lng], { 
        icon: homeIcon,
        zIndexOffset: -100 // ให้บ้านอยู่ล่างสุด
      }).addTo(map);
    } else {
      homeMarkerRef.current.setLatLng([homePosition.lat, homePosition.lng]);
    }
  }, [homePosition]);

  // Update drone heading
  useEffect(() => {
    if (!droneMarkerRef.current) return;
    const el = droneMarkerRef.current.getElement();
    if (el) {
      const iconBody = el.querySelector('.bg-blue-500') as HTMLElement;
      if (iconBody) {
        iconBody.style.transform = `rotate(${heading - 45}deg)`;
        iconBody.style.transition = 'transform 0.2s linear';
      }
    }
  }, [heading]);

  // Update waypoints on map
  useEffect(() => {
    if (!mapInstanceRef.current || !showWaypoints) return;
    const map = mapInstanceRef.current;

    // Clear old markers
    waypointMarkersRef.current.forEach(m => map.removeLayer(m));
    waypointMarkersRef.current = [];

    // Add new markers
    waypoints.forEach((wp, i) => {
      const marker = L.marker([wp.lat, wp.lng], {
        icon: createWaypointIcon(i + 1),
      }).addTo(map);
      waypointMarkersRef.current.push(marker);
    });

    // Update polyline
    if (waypointLinesRef.current) {
      map.removeLayer(waypointLinesRef.current);
      waypointLinesRef.current = null;
    }

    if (waypoints.length > 0) {
      const latlngs: [number, number][] = [];

      if (homePosition) {
        latlngs.push([homePosition.lat, homePosition.lng]);
      }

      waypoints.forEach(wp => latlngs.push([wp.lat, wp.lng]));

      waypointLinesRef.current = L.polyline(latlngs, {
        color: '#f97316',
        weight: 3,
        opacity: 0.8,
        dashArray: '10, 10',
      }).addTo(map);
    }
  }, [waypoints, homePosition, showWaypoints]);

  return (
    <div ref={mapContainerRef} className={`w-full h-full ${className}`} style={{ zIndex: 1 }} />
  );
};

export default DroneMap;
