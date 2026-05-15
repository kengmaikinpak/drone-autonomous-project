import React from 'react';
import { NavLink } from 'react-router-dom';
import { PlaneTakeoff, Map, LayoutDashboard, FileText } from 'lucide-react';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
}

const NavItem: React.FC<NavItemProps> = ({ to, icon, label }) => (
  <NavLink to={to} className="relative group">
    {({ isActive }) => (
      <>
        <div
          className={`w-full aspect-square flex items-center justify-center rounded-xl transition-all ${isActive
              ? 'bg-blue-50 text-blue-600 shadow-sm'
              : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
            }`}
        >
          {icon}
        </div>
        <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-slate-800 text-white text-[10px] px-2 py-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 font-bold tracking-wider">
          {label}
          <div className="absolute top-1/2 -translate-y-1/2 -left-1 border-t-4 border-t-transparent border-b-4 border-b-transparent border-r-4 border-r-slate-800" />
        </div>
      </>
    )}
  </NavLink>
);

const Sidebar: React.FC = () => {
  return (
    <nav className="w-20 bg-white border-r border-slate-200 flex flex-col items-center py-6 gap-6 z-30 flex-shrink-0 shadow-sm">
      {/* Logo */}
      <div className="mb-2">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg">
          <PlaneTakeoff className="w-6 h-6" />
        </div>
      </div>

      {/* Nav Items */}
      <div className="flex flex-col gap-4 w-full px-3">
        <NavItem to="/" icon={<Map className="w-6 h-6" />} label="Mission Planner" />
        <NavItem to="/dashboard" icon={<LayoutDashboard className="w-6 h-6" />} label="Dashboard" />
        <NavItem to="/logs" icon={<FileText className="w-6 h-6" />} label="Logs" />
      </div>
    </nav>
  );
};

export default Sidebar;
