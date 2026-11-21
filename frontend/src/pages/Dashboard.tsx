import { useState, useEffect, memo } from 'react';
import WaterGauge from '@/components/WaterGauge';
import {
  useTanks,
  useConfig,
  addSystemLog,
  useServerTimeOffset,
  isTankControllerOffline,
  isTankPlanned,
  Tank,
  SystemConfig,
  isPumpDemoOn,
  getPumpMode,
} from '@/store/useStore';
import { offlineThresholdMs, isTankInMaintenance, describePumpFault, tankThresholds } from '@/lib/alertEngine';
import type { UserProfile } from '@/services/authService';
import { useProcessedTankData } from '@/hooks/useUIStabilization';
import { WifiOff, User, Loader2, Wrench } from 'lucide-react';
import { PUMP_FEEDBACK_MS, DIRECTORY_COLLECTION } from '@/lib/constants';
import { resolvePumpCommand, type PendingPumpCommand, type PumpCommandOutcome } from '@/lib/pumpCommand';
import { useAuth } from '@/hooks/useAuth';
import { collection, onSnapshot } from 'firebase/firestore';
import { firestore } from '@/config/firebase';
import { formatLastSeen, formatRelativeTime } from '@/lib/formatTime';

interface TankCardProps {
  tank: Tank;
  config: SystemConfig;
  currentUser: UserProfile | null;
  isAdmin: boolean;
  onPumpToggle: (tankId: string, tankName: string, newState: boolean) => void;
  assignedWorkerName: string;
  isOffline: boolean;
  nowServer: number;
  /** Requested pump state while a command waits for the controller, else undefined */
  pumpPending?: boolean;
  /** Result of the last pump command, shown for a few seconds */
  pumpFeedback?: PumpCommandOutcome;
}

/**
 * TankCard Component
 * Displays the state of a single water tank reservoir.
 * Wrapped in memo with custom diffing to block unnecessary React re-renders from minor telemetry drift.
 */
const TankCard = memo(({
  tank,
  config,
  currentUser,
  isAdmin,
  onPumpToggle,
  assignedWorkerName,
  isOffline,
  nowServer,
  pumpPending,
  pumpFeedback,
}: TankCardProps) => {
  // Apply display stabilization: formats, rounds, and throttles values for clean UI presentation
  const processedTank = useProcessedTankData(tank);
  const isPlanned = isTankPlanned(tank);

  const status: 'safe' | 'warning' | 'danger' =
    !processedTank.enabled ? 'safe' :
    processedTank.status === 'danger' ? 'danger' :
    processedTank.status === 'warning' ? 'warning' :
    'safe';
  const disabled = !processedTank.enabled;

  const isWorker = currentUser?.role === 'worker';
  // The controller refuses every dashboard command while the Pump Control Lock is on (admins included)
  const pumpLocked = config.pumpControlLock === true;
  const canTogglePump = !pumpLocked && (isAdmin || (isWorker && processedTank.assignedWorker === currentUser?.id));
  const pumpMode = getPumpMode(config);
  const isPumpWaiting = pumpPending !== undefined;
  // This tank's own maintenance switch (the system-wide one has a banner above the cards)
  const tankMaintenance = !disabled && tank.maintenanceMode === true;
  const inMaintenance = !disabled && isTankInMaintenance(tank, config);
  const pumpToggleDisabled = disabled || isOffline || inMaintenance || !canTogglePump || isPumpWaiting;
  // Set by the controller's dry-run guard when it stopped the pump
  const pumpFaultReason = !disabled && !isPlanned && isPumpDemoOn(config) ? describePumpFault(tank.pumpFault) : null;

  return (
    <div className={`rounded-xl bg-card p-6 shadow-sm border transition-all ${
      isPlanned ? 'bg-muted/15 border-dashed border-border/80 opacity-75' : disabled ? 'opacity-50' : isOffline && !disabled ? 'border-border/80' : ''
    }`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground leading-tight">{processedTank.name}</h3>
          {processedTank.location && (
            <p className="text-xs text-muted-foreground mt-1 font-medium">{processedTank.location}</p>
          )}
        </div>
        {tankMaintenance ? (
          <span data-testid="tank-maintenance-badge" className="px-3 py-1 rounded-full text-xs font-semibold bg-warning/20 text-warning border border-warning/40 flex items-center gap-1.5">
            <Wrench size={12} />
            Under Maintenance
          </span>
        ) : isPlanned ? (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border">
            Planned - IoT not yet installed
          </span>
        ) : disabled ? (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-muted text-muted-foreground">Disabled</span>
        ) : isOffline ? (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border flex items-center gap-1.5 shadow-sm">
            <WifiOff size={12} className="text-amber-500" />
            Controller Offline
          </span>
        ) : (
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
            status === 'warning' ? 'bg-warning text-warning-foreground' :
            status === 'danger' ? 'bg-danger text-danger-foreground' :
            'bg-safe text-safe-foreground'
          }`}>
            {status === 'safe' ? 'Safe' : status === 'warning' ? 'Warning' : 'Danger'}
          </span>
        )}
      </div>

      <div className={`flex justify-center mb-6 transition-all ${isPlanned ? 'opacity-50 select-none' : isOffline && !disabled ? 'opacity-40 grayscale select-none' : ''}`}>
        {/* For planned tanks, WaterGauge renders static empty fill and '--' text */}
        <WaterGauge
          percentage={disabled || isPlanned ? 0 : processedTank.waterLevel}
          status={disabled || isOffline || isPlanned ? 'safe' : status}
          isPlanned={isPlanned}
        />
      </div>
      
      <div className="space-y-3 text-sm">
        <div className="flex justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">pH Level:</span>
          <div className={`flex items-center gap-2 ${!isPlanned && isOffline && !disabled ? 'opacity-40 grayscale' : ''}`}>
            {isPlanned ? (
              <span className="font-medium text-muted-foreground">--</span>
            ) : (
              <>
                {!disabled && !isOffline && processedTank.phAlert === 'CRITICAL' && (
                  <span className="text-[10px] bg-danger/10 text-danger border border-danger/20 px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">PH CRITICAL</span>
                )}
                {!disabled && !isOffline && processedTank.phAlert === 'WARNING' && (
                  <span className="text-[10px] bg-warning/10 text-warning border border-warning/20 px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">PH WARNING</span>
                )}
                {!disabled && !isOffline && processedTank.phAlert === 'RECOVERED' && (
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold uppercase">RECOVERED</span>
                )}
                <span className={`font-medium ${!isOffline && processedTank.phSensorOk === false ? 'text-danger font-bold flex items-center gap-1.5' : isOffline ? 'text-muted-foreground' : ''}`}>
                  {disabled ? '-' : processedTank.phLevel}
                  {!disabled && !isOffline && processedTank.phSensorOk === false && (
                    <span className="text-[10px] bg-danger/10 text-danger border border-danger/20 px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">FAULT</span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Water Level:</span>
          <div className={`flex items-center gap-2 ${!isPlanned && isOffline && !disabled ? 'opacity-40 grayscale' : ''}`}>
            {isPlanned ? (
              <span className="font-medium text-muted-foreground">--</span>
            ) : (
              <>
                {!disabled && !isOffline && processedTank.lowLevelAlert === 'CRITICAL' && (
                  <span className="text-[10px] bg-danger/10 text-danger border border-danger/20 px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">LOW WATER</span>
                )}
                {!disabled && !isOffline && processedTank.highLevelAlert === 'WARNING' && (
                  <span className="text-[10px] bg-warning/10 text-warning border border-warning/20 px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">OVERFLOW WARNING</span>
                )}
                {!disabled && !isOffline && (processedTank.lowLevelAlert === 'RECOVERED' || processedTank.highLevelAlert === 'RECOVERED') && (
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold uppercase">RECOVERED</span>
                )}
                <span className={`font-medium ${!isOffline && processedTank.levelSensorOk === false ? 'text-danger font-bold flex items-center gap-1.5' : isOffline ? 'text-muted-foreground' : ''}`}>
                  {disabled ? '-' : `${processedTank.waterHeight}m`}
                  {!disabled && !isOffline && processedTank.levelSensorOk === false && (
                    <span className="text-[10px] bg-danger/10 text-danger border border-danger/20 px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">FAULT</span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>
        {tankMaintenance && (
          <div
            role="status"
            data-testid="tank-maintenance-notice"
            className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning font-medium"
          >
            Maintenance: alerts for this tank are paused{isPumpDemoOn(config) ? ' and its pump is held off' : ''}.
          </div>
        )}
        {!isPlanned && !disabled && !isOffline && (processedTank.levelSensorOk === false || processedTank.phSensorOk === false) && (
          <div
            role="status"
            data-testid="sensor-fault-notice"
            className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            <span className="font-bold">
              {processedTank.levelSensorOk === false && processedTank.phSensorOk === false
                ? 'Water level and pH sensor fault'
                : processedTank.levelSensorOk === false
                ? 'Water level sensor fault'
                : 'pH sensor fault'}
            </span>
            {' - monitoring continues; readings may be inaccurate until the sensor is checked.'}
            {processedTank.levelSensorOk === false && isPumpDemoOn(config) && ' The pump stays off.'}
          </div>
        )}
        {pumpFaultReason && (
          <div
            role="status"
            data-testid="pump-fault-notice"
            className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            <span className="font-bold">Pump stopped automatically</span>
            {`: ${pumpFaultReason}. Check the water source, valve and pipe. Automatic refills stay blocked until the pump is turned ON here.`}
          </div>
        )}
        <div className="flex justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Last Seen:</span>
          <span className={`font-medium text-xs flex items-center gap-1 ${isPlanned ? 'text-muted-foreground' : isOffline ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-foreground'}`}>
            {isPlanned ? 'Not installed' : formatLastSeen(processedTank.lastUpdate, nowServer)}
          </span>
        </div>
        <div className="flex justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Assigned:</span>
          <span className="font-medium flex items-center gap-1">
            {disabled ? (
              <span className="text-muted-foreground">Disabled</span>
            ) : (
              <><User size={14} /> {assignedWorkerName}</>
            )}
          </span>
        </div>
        {isPumpDemoOn(config) && (
        <>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Pump:</span>
          <div className="flex items-center gap-2">
            {isPlanned ? (
              <span className="text-sm font-medium text-muted-foreground">--</span>
            ) : (
              <>
                <span
                  data-testid="pump-mode-badge"
                  title={pumpMode === 'manual' ? 'Manual mode: only pump commands start the pump' : 'Auto mode: the controller starts the pump at the low-level threshold'}
                  className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase border ${
                    pumpMode === 'manual'
                      ? 'bg-primary/10 text-primary border-primary/20'
                      : 'bg-muted text-muted-foreground border-border'
                  }`}
                >
                  {pumpMode === 'manual' ? 'Manual' : 'Auto'}
                </span>
                {isPumpWaiting ? (
                  <span data-testid="pump-status" className="text-sm font-medium text-primary flex items-center gap-1">
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    {pumpPending ? 'Turning ON…' : 'Turning OFF…'}
                  </span>
                ) : (
                  <span data-testid="pump-status" className={`text-sm font-medium ${processedTank.pumpOn && !disabled && !isOffline ? 'text-safe' : 'text-muted-foreground'}`}>
                    {processedTank.pumpOn && !disabled ? 'ON' : 'OFF'}
                  </span>
                )}
                <button
                  data-testid="pump-toggle"
                  aria-label={`Turn pump ${processedTank.pumpOn ? 'off' : 'on'}`}
                  aria-busy={isPumpWaiting}
                  disabled={pumpToggleDisabled}
                  onClick={() => onPumpToggle(processedTank.id, processedTank.name, !processedTank.pumpOn)}
                  title={isOffline ? 'Pump toggle disabled: Controller is offline' : inMaintenance ? 'Pump toggle disabled: Maintenance mode' : isPumpWaiting ? 'Waiting for the controller to confirm' : pumpLocked ? 'Pump toggle disabled: Pump Control Lock is on' : undefined}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    isPumpWaiting
                      ? `cursor-wait ${processedTank.pumpOn ? 'bg-primary/60' : 'bg-muted'}`
                      : pumpToggleDisabled
                      ? 'cursor-not-allowed bg-muted opacity-50'
                      : processedTank.pumpOn ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform flex items-center justify-center ${processedTank.pumpOn && !disabled ? 'translate-x-5' : ''}`}>
                    {isPumpWaiting && <Loader2 size={12} className="animate-spin text-primary" aria-hidden="true" />}
                  </span>
                </button>
              </>
            )}
          </div>
        </div>
        {!isPlanned && (isPumpWaiting || pumpFeedback) && (
          <p
            data-testid="pump-feedback"
            role="status"
            className={`text-[11px] text-right font-medium ${
              isPumpWaiting ? 'text-muted-foreground'
                : pumpFeedback?.kind === 'accepted' ? 'text-safe'
                : pumpFeedback?.kind === 'timeout' ? 'text-warning'
                : 'text-danger'
            }`}
          >
            {isPumpWaiting ? 'Waiting for the controller to confirm…' : pumpFeedback?.message}
          </p>
        )}
        {!isPlanned && !disabled && !inMaintenance && pumpMode === 'auto' && (
          <p data-testid="pump-auto-note" className="text-[11px] text-muted-foreground text-right">
            Auto: the pump may restart by itself at or below {tankThresholds(tank, config).lowLevelThreshold}%.
          </p>
        )}
        </>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Prevent unnecessary React re-renders caused by minor value changes
  const p = prevProps.tank;
  const n = nextProps.tank;

  // Immediately re-render on state changes that alter permissions, layout, or controls
  const prevPlanned = isTankPlanned(p);
  const nextPlanned = isTankPlanned(n);
  if (prevPlanned !== nextPlanned) return false;

  if (prevProps.isOffline !== nextProps.isOffline) return false;
  if (prevProps.pumpPending !== nextProps.pumpPending) return false;
  if (prevProps.pumpFeedback !== nextProps.pumpFeedback) return false;
  if (p.enabled !== n.enabled) return false;
  if (p.maintenanceMode !== n.maintenanceMode) return false;
  if (p.pumpOn !== n.pumpOn) return false;
  if (prevProps.assignedWorkerName !== nextProps.assignedWorkerName) return false;
  if (p.status !== n.status) return false;
  if (p.location !== n.location) return false;
  if (p.name !== n.name) return false;
  if (p.phSensorOk !== n.phSensorOk) return false;
  if (p.levelSensorOk !== n.levelSensorOk) return false;
  if (p.pumpFault !== n.pumpFault) return false;
  if (JSON.stringify(p.thresholds ?? null) !== JSON.stringify(n.thresholds ?? null)) return false;
  if (p.lowLevelAlert !== n.lowLevelAlert) return false;
  if (p.highLevelAlert !== n.highLevelAlert) return false;
  if (p.phAlert !== n.phAlert) return false;
  if (p.lastUpdate !== n.lastUpdate) return false;

  // Re-render when last-seen formatted string changes
  const prevLastSeen = formatLastSeen(p.lastUpdate, prevProps.nowServer);
  const nextLastSeen = formatLastSeen(n.lastUpdate, nextProps.nowServer);
  if (prevLastSeen !== nextLastSeen) return false;

  // Block re-renders if telemetry drifts are smaller than the display rounding precision (1 decimal place for pH, 5% intervals for Level)
  const prevPh = Math.round(p.phLevel * 10) / 10;
  const nextPh = Math.round(n.phLevel * 10) / 10;
  if (prevPh !== nextPh) return false;

  const prevLevel = Math.round(p.waterLevel / 5) * 5;
  const nextLevel = Math.round(n.waterLevel / 5) * 5;
  if (prevLevel !== nextLevel) return false;

  const prevHeight = Math.round(p.waterHeight * 100) / 100;
  const nextHeight = Math.round(n.waterHeight * 100) / 100;
  if (prevHeight !== nextHeight) return false;

  // Check if system config or session status changed
  if (prevProps.isAdmin !== nextProps.isAdmin) return false;
  if (prevProps.currentUser?.id !== nextProps.currentUser?.id) return false;
  if (prevProps.config.lowLevelThreshold !== nextProps.config.lowLevelThreshold) return false;
  if (prevProps.config.overflowThreshold !== nextProps.config.overflowThreshold) return false;
  if (prevProps.config.minPh !== nextProps.config.minPh) return false;
  if (prevProps.config.maxPh !== nextProps.config.maxPh) return false;
  if (prevProps.config.maintenanceMode !== nextProps.config.maintenanceMode) return false;
  if (prevProps.config.pumpControlLock !== nextProps.config.pumpControlLock) return false;
  if (isPumpDemoOn(prevProps.config) !== isPumpDemoOn(nextProps.config)) return false;
  if (getPumpMode(prevProps.config) !== getPumpMode(nextProps.config)) return false;

  return true; // Values are visually identical; suppress rendering update
});

const Dashboard = () => {
  const { tanks, isLive, updateTank } = useTanks();
  const serverTimeOffset = useServerTimeOffset();
  // Operator names by UID (Firestore directory/: names only; full profiles are admin-only)
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const { config } = useConfig();
  const { currentUser } = useAuth();
  const addLog = addSystemLog;

  // Firestore real-time listener for operator names, to show who each tank is assigned to
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(firestore, DIRECTORY_COLLECTION), (snapshot) => {
      const names: Record<string, string> = {};
      snapshot.forEach(doc => {
        const name = (doc.data() as { username?: unknown }).username;
        if (typeof name === 'string') names[doc.id] = name;
      });
      setUserNames(names);
    }, (error) => {
      // Assignments fall back to "Unknown" rather than leaving the page blank
      console.error('Error listening to user profiles:', error);
    });
    return () => unsubscribe();
  }, []);
  const isAdmin = currentUser?.role === 'admin';
  const [pumpConfirm, setPumpConfirm] = useState<{ tankId: string; tankName: string; newState: boolean } | null>(null);
  // Pump commands waiting for the controller's acknowledgment, and recent results (per tank id)
  const [pumpPending, setPumpPending] = useState<Record<string, PendingPumpCommand>>({});
  const [pumpFeedback, setPumpFeedback] = useState<Record<string, PumpCommandOutcome & { until: number }>>({});

  // Synchronized server clock timer (ticks every 1000ms using Firebase server time offset)
  const [nowServer, setNowServer] = useState(() => Date.now() + serverTimeOffset);

  useEffect(() => {
    setNowServer(Date.now() + serverTimeOffset);
    const interval = setInterval(() => {
      setNowServer(Date.now() + serverTimeOffset);
    }, 1000);

    return () => clearInterval(interval);
  }, [serverTimeOffset]);

  // End each pump wait once the controller acknowledges it (or it times out),
  // and drop results that have been shown long enough. Runs on every tank
  // update and on the 1 s clock tick.
  useEffect(() => {
    const now = Date.now();
    const resolved: Record<string, PumpCommandOutcome> = {};
    for (const [tankId, pending] of Object.entries(pumpPending)) {
      const outcome = resolvePumpCommand(pending, tanks.find(t => t.id === tankId), now);
      if (outcome) resolved[tankId] = outcome;
    }
    const resolvedIds = Object.keys(resolved);
    if (resolvedIds.length > 0) {
      setPumpPending(prev => {
        const next = { ...prev };
        resolvedIds.forEach(id => delete next[id]);
        return next;
      });
    }
    setPumpFeedback(prev => {
      const next: typeof prev = {};
      let changed = false;
      for (const [id, fb] of Object.entries(prev)) {
        if (fb.until > now) next[id] = fb; else changed = true;
      }
      for (const id of resolvedIds) {
        next[id] = { ...resolved[id], until: now + PUMP_FEEDBACK_MS };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [tanks, pumpPending, nowServer]);

  // Connection status & relative heartbeat timer calculations
  // Select active operational tank (skip planned expansion tanks)
  const activeTank = tanks.find(t => !isTankPlanned(t)) || tanks[0];
  const lastUpdate = activeTank?.lastUpdate;
  const wifiConnected = activeTank?.wifiConnected ?? true;
  const firebaseConnected = activeTank?.firebaseConnected ?? true;
  const ethConnected = activeTank?.ethConnected ?? false;
  const rssi = activeTank?.rssi ?? -50;

  // Compare against Firebase server time (not browser clock)
  const secondsSinceUpdate = lastUpdate ? Math.max(0, Math.floor((nowServer - lastUpdate) / 1000)) : 999;
  // Offline threshold comes from the Admin Panel setting (default 30 s)
  const offlineMs = offlineThresholdMs(config);
  const offlineSec = Math.round(offlineMs / 1000);
  const isOnline = secondsSinceUpdate * 1000 <= offlineMs;
  
  let connectionStatus: 'online' | 'reconnecting' | 'offline' = 'online';
  if (!isOnline) {
    connectionStatus = 'offline';
  } else if (!firebaseConnected) {
    connectionStatus = 'reconnecting';
  }

  const getSignalStrength = (rssiVal: number) => {
    if (!isOnline) return { label: 'Controller Offline', color: 'text-amber-500 bg-amber-500/10 border-amber-500/20' };
    if (ethConnected) return { label: 'Ethernet', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' };
    if (!wifiConnected) return { label: 'Disconnected', color: 'text-danger bg-danger/10 border-danger/20' };
    
    if (rssiVal >= -50) return { label: 'Signal: Excellent', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' };
    if (rssiVal >= -70) return { label: 'Signal: Good', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' };
    if (rssiVal >= -85) return { label: 'Signal: Fair', color: 'text-warning bg-warning/10 border-warning/20' };
    return { label: 'Signal: Poor', color: 'text-danger bg-danger/10 border-danger/20' };
  };

  const signalInfo = getSignalStrength(rssi);

  const getWorkerName = (id: string | null) => {
    if (!id) return 'Unassigned';
    return userNames[id] ?? 'Unknown';
  };

  const handlePumpToggle = (tankId: string, tankName: string, newState: boolean) => {
    const targetTank = tanks.find(t => t.id === tankId);
    if (!targetTank || isTankPlanned(targetTank) || isTankControllerOffline(targetTank, serverTimeOffset, offlineMs)) {
      return; // Cannot toggle pump on planned tanks or when controller is offline
    }
    if (isTankInMaintenance(targetTank, config)) return; // the controller refuses commands during maintenance
    if (pumpPending[tankId]) return; // the last command is still waiting for the controller
    setPumpConfirm({ tankId, tankName, newState });
  };

  const confirmPumpToggle = () => {
    if (!pumpConfirm) return;
    const targetTank = tanks.find(t => t.id === pumpConfirm.tankId);
    if (targetTank && isTankControllerOffline(targetTank, serverTimeOffset, offlineMs)) {
      setPumpConfirm(null);
      return;
    }
    const { tankId, newState } = pumpConfirm;
    // Remember the controller's last acknowledgment; the spinner stops when it changes
    setPumpPending(prev => ({
      ...prev,
      [tankId]: { requested: newState, ackBefore: targetTank?.pumpCommandAt, sentAt: Date.now() },
    }));
    setPumpFeedback(prev => {
      if (!prev[tankId]) return prev;
      const next = { ...prev };
      delete next[tankId];
      return next;
    });
    const { tankName } = pumpConfirm;
    Promise.resolve(updateTank(tankId, { pumpOn: newState })).then(() => {
      // Logged only once the database accepted the command (a refused write is not a command)
      addLog({
        action: newState ? 'PUMP_ON' : 'PUMP_OFF',
        details: `Pump for ${tankName} was turned ${newState ? 'ON' : 'OFF'}`,
        performedBy: currentUser?.username || 'Unknown',
        // Reports → Pump Activity Log shows who switched which tank's pump
        tankId,
        ...(currentUser?.role ? { performedByRole: currentUser.role } : {}),
      });
    }).catch((err: unknown) => {
      setPumpPending(prev => {
        const next = { ...prev };
        delete next[tankId];
        return next;
      });
      setPumpFeedback(prev => ({
        ...prev,
        [tankId]: {
          kind: 'error',
          message: `Could not send the command: ${err instanceof Error ? err.message : String(err)}`,
          until: Date.now() + PUMP_FEEDBACK_MS,
        },
      }));
    });

    setPumpConfirm(null);
  };

  return (
    <div>
      {!isLive && (
        <div data-testid="cached-data-banner" className="mb-4 p-3 rounded-lg bg-muted border border-border text-muted-foreground text-sm font-medium">
          Loading live readings... Values shown are the last ones saved on this device.
        </div>
      )}
      {config.maintenanceMode && (
        <div className="mb-4 p-3 rounded-lg bg-warning/20 border border-warning text-warning text-sm font-medium flex items-center gap-2">
          ⚠️ Maintenance Mode is active — Alerts are suppressed{isPumpDemoOn(config) ? ' and the pump is stopped' : ''}.
        </div>
      )}
      {isPumpDemoOn(config) && config.pumpControlLock && !config.maintenanceMode && (
        <div className="mb-4 p-3 rounded-lg bg-danger/20 border border-danger text-danger text-sm font-medium flex items-center gap-2">
          🔒 Pump Control Lock is active — pump commands from the dashboard are locked for all users.
        </div>
      )}
      {/* Premium Connection Status Banner */}
      <div className={`mb-6 p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 transition-all duration-300 ${
        connectionStatus === 'online' ? 'bg-emerald-500/5 border-emerald-500/15' :
        connectionStatus === 'reconnecting' ? 'bg-warning/5 border-warning/15' :
        'bg-danger/5 border-danger/15'
      }`}>
        <div className="flex items-center gap-3">
          {/* Status Indicator Dot */}
          <div className="relative flex h-3 w-3">
            {connectionStatus !== 'offline' && (
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                connectionStatus === 'online' ? 'bg-emerald-500' : 'bg-warning'
              }`} />
            )}
            <span className={`relative inline-flex rounded-full h-3 w-3 ${
              connectionStatus === 'online' ? 'bg-emerald-500' :
              connectionStatus === 'reconnecting' ? 'bg-warning' : 'bg-danger'
            }`} />
          </div>
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              System Controller: {
                connectionStatus === 'online' ? 'Online' :
                connectionStatus === 'reconnecting' ? 'Reconnecting to Database' : 'Controller Offline'
              }
            </h2>
            <p className="text-xs text-muted-foreground">
              {connectionStatus === 'offline' ? (
                `${activeTank?.name ?? 'The controller'} has not reported for over ${offlineSec} seconds. Controller is offline.`
              ) : (
                `ESP32 reporting active. Heartbeat received ${formatRelativeTime(secondsSinceUpdate)}.`
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {connectionStatus !== 'offline' && (
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${signalInfo.color}`}>
              {signalInfo.label} {!ethConnected && wifiConnected && `(${rssi} dBm)`}
            </span>
          )}
          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-secondary text-secondary-foreground border border-border">
            {activeTank?.name ?? 'No controller'} · ESP32
          </span>
        </div>
      </div>

      <div data-testid="tank-grid" className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-4 md:gap-6">
        {tanks.map(tank => {
          const isOffline = isTankControllerOffline(tank, serverTimeOffset, offlineMs);
          return (
            <TankCard
              key={tank.id}
              tank={tank}
              config={config}
              currentUser={currentUser}
              isAdmin={isAdmin}
              onPumpToggle={handlePumpToggle}
              assignedWorkerName={getWorkerName(tank.assignedWorker)}
              isOffline={isOffline}
              nowServer={nowServer}
              pumpPending={pumpPending[tank.id]?.requested}
              pumpFeedback={pumpFeedback[tank.id]}
            />
          );
        })}
      </div>

      {pumpConfirm && isPumpDemoOn(config) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50">
          <div className="bg-card rounded-xl p-6 shadow-lg max-w-sm w-full mx-4 space-y-4">
            <h4 className="text-lg font-semibold text-foreground">Confirm Pump Toggle</h4>
            <div className="text-sm text-muted-foreground space-y-3">
              <p>
                Are you sure you want to turn <span className="font-semibold text-foreground">{pumpConfirm.newState ? 'ON' : 'OFF'}</span> the pump for <span className="font-semibold text-foreground">{pumpConfirm.tankName}</span>?
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPumpConfirm(null)} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary transition">Cancel</button>
              <button onClick={confirmPumpToggle} className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
