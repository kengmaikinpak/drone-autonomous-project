import React from 'react';
import { Satellite, Wifi, ShieldCheck, Monitor, PlaneTakeoff } from 'lucide-react';
import { useRos } from '@/contexts/RosContext';

interface HealthIconProps {
  isHealthy: boolean;
  icon: React.ReactNode;
  label: string;
}

const HealthIcon: React.FC<HealthIconProps> = ({ isHealthy, icon, label }) => (
  <div className="flex flex-col items-center gap-1">
    <div
      className={`p-2 rounded-full ${
        isHealthy ? 'bg-green-50 text-green-500' : 'bg-slate-50 text-slate-400'
      }`}
    >
      {icon}
    </div>
    <span className="text-[8px] font-bold uppercase">{label}</span>
  </div>
);

interface Props {
  compact?: boolean;
}

const HealthIndicators: React.FC<Props> = ({ compact = false }) => {
  const { healthStatus } = useRos();

  if (compact) {
    return (
      <div className="flex gap-2">
        <div
          className={`flex-1 p-2 rounded-lg flex justify-center ${
            healthStatus.gps ? 'bg-green-50 text-green-500' : 'bg-slate-50 text-slate-400'
          }`}
          title="GPS"
        >
          <Satellite className="w-4 h-4" />
        </div>
        <div
          className={`flex-1 p-2 rounded-lg flex justify-center ${
            healthStatus.wifi ? 'bg-green-50 text-green-500' : 'bg-slate-50 text-slate-400'
          }`}
          title="WiFi"
        >
          <Wifi className="w-4 h-4" />
        </div>
        <div
          className={`flex-1 p-2 rounded-lg flex justify-center ${
            healthStatus.arm ? 'bg-green-50 text-green-500' : 'bg-slate-50 text-slate-400'
          }`}
          title="Arm"
        >
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div
          className={`flex-1 p-2 rounded-lg flex justify-center ${
            healthStatus.gcs ? 'bg-green-50 text-green-500' : 'bg-slate-50 text-slate-400'
          }`}
          title="GCS"
        >
          <Monitor className="w-4 h-4" />
        </div>
        <div
          className={`flex-1 p-2 rounded-lg flex justify-center ${
            healthStatus.fcu ? 'bg-green-50 text-green-500' : 'bg-slate-50 text-slate-400'
          }`}
          title="FCU"
        >
          <PlaneTakeoff className="w-4 h-4" />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-5 gap-2 text-center">
      <HealthIcon isHealthy={healthStatus.gps} icon={<Satellite className="w-4 h-4" />} label="GPS" />
      <HealthIcon isHealthy={healthStatus.wifi} icon={<Wifi className="w-4 h-4" />} label="Wifi" />
      <HealthIcon isHealthy={healthStatus.arm} icon={<ShieldCheck className="w-4 h-4" />} label="Arm" />
      <HealthIcon isHealthy={healthStatus.gcs} icon={<Monitor className="w-4 h-4" />} label="GCS" />
      <HealthIcon isHealthy={healthStatus.fcu} icon={<PlaneTakeoff className="w-4 h-4" />} label="FCU" />
    </div>
  );
};

export default HealthIndicators;
