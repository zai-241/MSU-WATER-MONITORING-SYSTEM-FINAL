import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FileText, Settings, LogOut, Droplet, Menu, X, Clock, ScrollText, Bell, WifiOff } from 'lucide-react';
import { useClock, useConnectionState } from '@/store/useStore';
import { useAuth } from '@/hooks/useAuth';
import NotificationCenter from './NotificationCenter';
import SystemMonitor from './SystemMonitor';
import { refreshPushRegistration } from '@/utils/push';

const SystemClock = () => {
  const clock = useClock();
  const [dateStr, timeStr] = clock.includes(' - ') ? clock.split(' - ') : ['', clock];

  return (
    <div className="hidden min-[360px]:flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-muted-foreground font-mono whitespace-nowrap">
      <Clock size={14} className="shrink-0" />
      <span className="hidden md:inline">System Server Clock</span>
      {dateStr && (
        <span className="hidden sm:inline text-[10px] bg-muted px-1.5 py-0.5 rounded border border-border/40 font-semibold">
          {dateStr}
        </span>
      )}
      <span className="font-semibold text-foreground">{timeStr}</span>
    </div>
  );
};

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const isConnected = useConnectionState();
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const isAdmin = currentUser?.role === 'admin';
  const isWorker = currentUser?.role === 'worker';

  // Push tokens rotate: if this device already has push on, re-register quietly (never prompts)
  useEffect(() => {
    if (currentUser?.id) refreshPushRegistration(currentUser.id);
  }, [currentUser?.id]);

  const handleLogout = () => { 
    logout(); 
    setShowLogoutConfirm(false);
    navigate('/login'); 
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2 lg:px-4 lg:py-3 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-sidebar-active text-sidebar-active-foreground' : 'text-sidebar-foreground hover:bg-sidebar-foreground/10'
    }`;

  const sidebarContent = (
    <>
      <div className="flex items-center gap-3 mb-5 lg:mb-8">
        <div className="flex h-9 w-9 lg:h-10 lg:w-10 items-center justify-center rounded-full bg-sidebar-foreground/20">
          <Droplet className="h-4.5 w-4.5 lg:h-5 lg:w-5 text-sidebar-foreground" />
        </div>
        <div>
          <h2 className="font-bold text-sidebar-foreground text-xs lg:text-sm leading-tight">Water</h2>
          <h2 className="font-bold text-sidebar-foreground text-xs lg:text-sm leading-tight">Monitoring</h2>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto scrollbar-none">
        <NavLink to="/dashboard" className={linkClass} onClick={() => setMobileOpen(false)}>
          <LayoutDashboard size={16} className="lg:w-[18px] lg:h-[18px]" /> Dashboard
        </NavLink>
        {(isAdmin || isWorker) && (
          <NavLink to="/reports" className={linkClass} onClick={() => setMobileOpen(false)}>
            <FileText size={16} className="lg:w-[18px] lg:h-[18px]" /> Reports
          </NavLink>
        )}
        {(isAdmin || isWorker) && (
          <NavLink to="/logs" className={linkClass} onClick={() => setMobileOpen(false)}>
            <ScrollText size={16} className="lg:w-[18px] lg:h-[18px]" /> System Logs
          </NavLink>
        )}
        <NavLink to="/notifications" className={linkClass} onClick={() => setMobileOpen(false)}>
          <Bell size={16} className="lg:w-[18px] lg:h-[18px]" /> Notifications
        </NavLink>
        {isAdmin && (
          <NavLink to="/admin" className={linkClass} onClick={() => setMobileOpen(false)}>
            <Settings size={16} className="lg:w-[18px] lg:h-[18px]" /> Admin Panel
          </NavLink>
        )}
      </nav>
      <button onClick={() => { setMobileOpen(false); setShowLogoutConfirm(true); }} className="flex items-center gap-3 px-3 py-2 lg:px-4 lg:py-3 text-sm text-sidebar-foreground hover:bg-sidebar-foreground/10 rounded-lg transition-colors w-full text-left">
        <LogOut size={16} className="lg:w-[18px] lg:h-[18px]" /> Logout
      </button>
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      <SystemMonitor />
      {mobileOpen && <div className="fixed inset-0 z-30 bg-foreground/50 lg:hidden" onClick={() => setMobileOpen(false)} />}

      {/* Mobile sidebar */}
      <div className={`fixed left-0 top-0 z-40 flex h-[100dvh] w-52 flex-col bg-sidebar p-3.5 overflow-hidden transform transition-transform lg:hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center text-sidebar-foreground"><X size={20} /></button>
        {sidebarContent}
      </div>

      {/* Desktop sidebar */}
      <aside className="fixed left-0 top-0 z-40 hidden lg:flex h-screen w-56 flex-col bg-sidebar p-4">
        {sidebarContent}
      </aside>

      <div className="lg:ml-56">
        {!isConnected && (
          <div
            data-testid="connection-lost-banner"
            className="bg-amber-500 text-amber-950 px-4 py-2 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 shadow-sm border-b border-amber-600/30 animate-in slide-in-from-top duration-300"
          >
            <WifiOff size={16} className="animate-pulse flex-shrink-0" />
            <span>Connection to Realtime Database lost. You are offline — live telemetry and alerts may be stale. Reconnecting...</span>
          </div>
        )}
        <header className="flex items-center justify-between gap-2 px-2 py-2 sm:px-6 sm:py-3">
          <div className="flex min-w-0 items-center gap-1 sm:gap-3">
            <button onClick={() => setMobileOpen(true)} aria-label="Open menu" className="lg:hidden flex h-11 w-11 shrink-0 items-center justify-center text-foreground hover:opacity-80 transition">
              <Menu size={24} />
            </button>
            {/* Phones show only the initial; the full name appears from 640px */}
            <div
              className="flex min-w-0 items-center gap-2 text-sm bg-secondary/30 p-1.5 sm:px-3 rounded-lg border border-border/40 animate-in fade-in duration-300"
              title={currentUser?.username || 'Guest'}
            >
              <div className="h-6 w-6 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs uppercase border border-primary/20">
                {(currentUser?.username || 'G').charAt(0)}
              </div>
              <span className="hidden sm:inline truncate max-w-[12rem] font-semibold text-foreground text-sm">
                {currentUser?.username || 'Guest'}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 justify-end items-center gap-1 sm:gap-3">
            <SystemClock />

            <div className="hidden sm:block w-px h-6 bg-border" />

            <NotificationCenter />
          </div>
        </header>
        {/* Extra bottom room on phones so toasts (bottom of the screen) never hide the last controls */}
        <main className="px-3 pb-[calc(env(safe-area-inset-bottom)+6rem)] sm:px-6 sm:pb-8">{children}</main>
      </div>

      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm">
          <div className="bg-card rounded-xl p-6 shadow-xl max-w-sm w-full mx-4 border border-border/40 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-danger mb-2">
              <LogOut size={24} className="text-primary animate-pulse" />
              <h4 className="text-lg font-bold text-foreground">Confirm Sign Out</h4>
            </div>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to end your active session and log out of the MSU Water Monitoring System?
            </p>
            <div className="flex gap-3 pt-2">
              <button 
                onClick={() => setShowLogoutConfirm(false)} 
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition text-foreground"
              >
                Cancel
              </button>
              <button 
                onClick={handleLogout} 
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AppLayout;
