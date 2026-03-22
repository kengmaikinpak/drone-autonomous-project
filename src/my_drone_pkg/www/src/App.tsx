import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from '@/components/Sidebar';
import DashboardPage from '@/pages/DashboardPage';
import MissionPlannerPage from '@/pages/MissionPlannerPage';
import { RosProvider } from '@/contexts/RosContext';
import { MissionProvider } from '@/contexts/MissionContext';
import { SettingsProvider } from '@/contexts/SettingsContext';

const App: React.FC = () => {
  return (
    <SettingsProvider>
      <RosProvider>
        <MissionProvider>
          <div className="flex h-screen overflow-hidden text-slate-700">
            <Sidebar />
            <Routes>
              <Route path="/" element={<MissionPlannerPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
            </Routes>
          </div>
        </MissionProvider>
      </RosProvider>
    </SettingsProvider>
  );
};

export default App;
