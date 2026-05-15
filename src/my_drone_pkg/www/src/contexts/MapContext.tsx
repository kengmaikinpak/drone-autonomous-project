import React, { createContext, useContext, useState } from 'react';
import type { MapContextType } from '@/types';

const MapContext = createContext<MapContextType>({
  map: null,
  setMap: () => {},
});

export const useMap = () => useContext(MapContext);

interface Props {
  children: React.ReactNode;
}

export const MapProvider: React.FC<Props> = ({ children }) => {
  const [map, setMap] = useState<L.Map | null>(null);

  return (
    <MapContext.Provider value={{ map, setMap }}>
      {children}
    </MapContext.Provider>
  );
};
