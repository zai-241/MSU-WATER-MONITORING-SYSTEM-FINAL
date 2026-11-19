import { useState, useEffect } from 'react';
import { useTanks, useConfig, useWorkerStatus, addSystemLog, isPumpDemoOn, getPumpMode, SystemConfig, Tank, PumpMode } from '@/store/useStore';
import { Power, Settings, Loader2, Bell, Hand, Moon, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { z } from 'zod';
import { DEFAULT_TANK_IDS, tankIdsInOrder } from '@/lib/constants';
import DeviceAccounts from './DeviceAccounts';
import LiveCalibrationPanel from './LiveCalibrationPanel';
import { errorMessage } from '@/lib/utils';
import {
  nightSettings,
  formatHour12,
  MIN_NIGHT_DROP_PERCENT,
  NIGHT_FAST_WINDOW_MS,
} from '@/lib/alertEngine';

// Validation schemas (E2 / R8)
const thresholdSchema = z.object({
  lowLevelThreshold: z.number({ invalid_type_error: 'Low-level threshold must be a number' })
    .min(0, 'Low-level threshold must be at least 0%')
    .max(100, 'Low-level threshold cannot exceed 100%'),
  overflowThreshold: z.number({ invalid_type_error: 'Overflow threshold must be a number' })
    .min(0, 'Overflow threshold must be at least 0%')
    .max(100, 'Overflow threshold cannot exceed 100%'),
  minPh: z.number({ invalid_type_error: 'Minimum pH must be a number' })
    .min(0, 'Minimum pH must be at least 0')
    .max(14, 'Minimum pH cannot exceed 14'),
  maxPh: z.number({ invalid_type_error: 'Maximum pH must be a number' })
    .min(0, 'Maximum pH must be at least 0')
    .max(14, 'Maximum pH cannot exceed 14'),
  offlineThresholdSec: z.number({ invalid_type_error: 'Offline threshold must be a number' })
    .min(20, 'Offline threshold must be at least 20 seconds (min 2 heartbeats)')
    .max(3600, 'Offline threshold cannot exceed 3600 seconds')
    .optional(),
  repeatIntervalSec: z.number({ invalid_type_error: 'Repeat interval must be a number' })
    .min(10, 'Repeat interval must be at least 10 seconds')
    .max(3600, 'Repeat interval cannot exceed 3600 seconds')
    .optional(),
  soundEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  nightWatchEnabled: z.boolean().optional(),
  nightStartHour: z.number().int().min(0).max(23).optional(),
  nightEndHour: z.number().int().min(0).max(23).optional(),
  nightFastDropPercent: z.number({ invalid_type_error: 'Fast drop must be a number' })
    .min(MIN_NIGHT_DROP_PERCENT, `Fast drop must be at least ${MIN_NIGHT_DROP_PERCENT}% (the level changes in 2% steps)`)
    .max(100, 'Fast drop cannot exceed 100%')
    .optional(),
  nightSlowDropPercent: z.number({ invalid_type_error: 'Total night drop must be a number' })
    .min(MIN_NIGHT_DROP_PERCENT, `Total night drop must be at least ${MIN_NIGHT_DROP_PERCENT}% (the level changes in 2% steps)`)
    .max(100, 'Total night drop cannot exceed 100%')
    .optional(),
}).refine(data => data.nightStartHour === undefined || data.nightStartHour !== data.nightEndHour, {
  message: 'Night watch start and end hours must be different',
  path: ['nightStartHour'],
}).refine(data => data.lowLevelThreshold < data.overflowThreshold, {
  message: 'Low-level threshold must be strictly less than overflow threshold',
  path: ['lowLevelThreshold'],
}).refine(data => data.minPh < data.maxPh, {
  message: 'Minimum pH must be strictly less than maximum pH',
  path: ['minPh'],
});

const calibrationSchema = z.object({
  levelVmin: z.number().min(0, 'Vmin must be >= 0'),
  levelVmax: z.number().min(0, 'Vmax must be >= 0'),
  tankHeight: z.number().positive('Tank height must be greater than 0 meters'),
  capacityLiters: z.number({ invalid_type_error: 'Tank capacity must be a number' }).positive('Tank capacity must be greater than 0 liters'),
  levelOffset: z.number(),
  phNeutralVoltage: z.number().positive('pH neutral voltage must be greater than 0V'),
  phSlope: z.number().positive('pH slope sensitivity must be greater than 0'),
  phOffset: z.number(),
}).refine(data => data.levelVmin < data.levelVmax, {
  message: 'Vmin (empty tank voltage) must be strictly less than Vmax (full tank voltage)',
  path: ['levelVmin'],
});

type ControlKey = 'maintenanceMode' | 'pumpControlLock' | 'pumpDemoMode';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Form state: while typing, number fields hold the raw text; saving converts them with Number(). */
type Editable<T> = { [K in keyof T]: T[K] | string };

const Configuration = () => {
  const { config, updateConfig } = useConfig();
  const { tanks, updateTank } = useTanks();
  // Every registered tank (Tanks 1–4 and any added in Tank Assignment), in number order
  const tankIds = tanks.length ? tankIdsInOrder(tanks.map(t => t.id)) : [...DEFAULT_TANK_IDS];
  const workerStatus = useWorkerStatus();
  const addLog = addSystemLog;
  const { currentUser } = useAuth();
  
  // Local state to prevent database spamming on keystrokes
  const [localConfig, setLocalConfig] = useState<Editable<SystemConfig> | null>(null);
  const [localTank, setLocalTank] = useState<Partial<Editable<Tank>> | null>(null);
  const [isConfigDirty, setIsConfigDirty] = useState(false);
  const [isTankDirty, setIsTankDirty] = useState(false);
  
  const [controlConfirm, setControlConfirm] = useState<{ key: ControlKey; label: string; newState: boolean } | null>(null);
  const [modeConfirm, setModeConfirm] = useState<PumpMode | null>(null);
  const [tankMaintenanceConfirm, setTankMaintenanceConfirm] = useState<{ tankId: string; label: string; newState: boolean } | null>(null);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const isAdmin = currentUser?.role === 'admin';
  const [isSaving, setIsSaving] = useState(false);

  // Tank whose calibration the form shows, and a tank the user picked while the form had unsaved edits
  const [selectedTankId, setSelectedTankId] = useState<string>(DEFAULT_TANK_IDS[0]);
  const [pendingTankId, setPendingTankId] = useState<string | null>(null);

  const selectedTank = tanks.find(t => t.id === selectedTankId);
  const selectedTankLabel = `Tank ${selectedTankId}`;

  // Initialize and synchronize local states when database loads (B8: don't overwrite if form is dirty)
  useEffect(() => {
    if (config && (!localConfig || !isConfigDirty)) {
      setLocalConfig(config);
    }
    // localConfig is only read to see whether the form is empty; it must not re-run this sync
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, isConfigDirty]);

  useEffect(() => {
    if (selectedTank && (!localTank || !isTankDirty || localTank.id !== selectedTank.id)) {
      setLocalTank(selectedTank);
    }
    // localTank is only read to see whether the form is empty or shows another tank
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTank, isTankDirty]);

  const switchTank = (tankId: string) => {
    setSelectedTankId(tankId);
    setIsTankDirty(false);
    setLocalTank(tanks.find(t => t.id === tankId) ?? null);
    setPendingTankId(null);
  };

  const handleSelectTank = (tankId: string) => {
    if (tankId === selectedTankId) return;
    if (isTankDirty) {
      setPendingTankId(tankId); // ask before discarding unsaved calibration edits
      return;
    }
    switchTank(tankId);
  };

  const handleToggle = (key: ControlKey, label: string) => {
    if (!localConfig) return;
    // pumpDemoMode counts as on when it was never set
    const current = key === 'pumpDemoMode' ? isPumpDemoOn(localConfig as SystemConfig) : localConfig[key] === true;
    setControlConfirm({ key, label, newState: !current });
  };

  const confirmToggle = async () => {
    if (!controlConfirm || !localConfig) return;
    try {
      await updateConfig({ [controlConfirm.key]: controlConfirm.newState });
      toast.success(`${controlConfirm.label} successfully ${controlConfirm.newState ? 'enabled' : 'disabled'}!`);
      setControlConfirm(null);
    } catch (err) {
      toast.error(errorMessage(err) || `Failed to update ${controlConfirm.label}`);
    }
  };

  const confirmTankMaintenance = async () => {
    if (!tankMaintenanceConfirm || !isAdmin) return;
    const { tankId, label, newState } = tankMaintenanceConfirm;
    try {
      await updateTank(tankId, { maintenanceMode: newState });
      addLog({
        action: 'Configuration Updated',
        details: `Maintenance mode ${newState ? 'enabled' : 'disabled'} for ${label}`,
        performedBy: currentUser?.username || 'Administrator',
        logLevel: newState ? 'WARNING' : 'INFO',
        tankId,
      });
      toast.success(`Maintenance for ${label} ${newState ? 'enabled' : 'disabled'}`);
      setTankMaintenanceConfirm(null);
    } catch (err) {
      toast.error(errorMessage(err) || `Failed to update maintenance for ${label}`);
    }
  };

  const confirmPumpMode = async () => {
    if (!modeConfirm || !isAdmin) return;
    const previous = getPumpMode(config);
    try {
      await updateConfig({ pumpMode: modeConfirm });
      addLog({
        action: 'Configuration Updated',
        details: `Pump mode changed (${previous.toUpperCase()} -> ${modeConfirm.toUpperCase()})`,
        performedBy: currentUser?.username || 'Administrator',
        logLevel: 'INFO'
      });
      toast.success(`Pump mode set to ${modeConfirm === 'manual' ? 'Manual' : 'Auto'}`);
      setModeConfirm(null);
    } catch (err) {
      toast.error(errorMessage(err) || 'Failed to update pump mode');
    }
  };


  // Night watch values as saved (defaults filled in), shown until the form changes them
  const night = nightSettings(config);

  const handleSaveAll = async () => {
    if (!localConfig) return;
    setIsSaving(true);
    try {
      // Clean and parse all inputs before committing to Firebase
      // Only the number fields can hold typed text; they are converted below
      const parsedConfig: SystemConfig = {
        ...(localConfig as SystemConfig),
        lowLevelThreshold: Number(localConfig.lowLevelThreshold),
        overflowThreshold: Number(localConfig.overflowThreshold),
        minPh: Number(localConfig.minPh),
        maxPh: Number(localConfig.maxPh),
        offlineThresholdSec: localConfig.offlineThresholdSec !== undefined ? Number(localConfig.offlineThresholdSec) : 30,
        repeatIntervalSec: localConfig.repeatIntervalSec !== undefined ? Number(localConfig.repeatIntervalSec) : 60,
        soundEnabled: localConfig.soundEnabled !== false,
        pushEnabled: localConfig.pushEnabled !== false,
        nightWatchEnabled: localConfig.nightWatchEnabled !== false,
        nightStartHour: Number(localConfig.nightStartHour ?? night.startHour),
        nightEndHour: Number(localConfig.nightEndHour ?? night.endHour),
        nightFastDropPercent: Number(localConfig.nightFastDropPercent ?? night.fastDrop),
        nightSlowDropPercent: Number(localConfig.nightSlowDropPercent ?? night.slowDrop),
      };

      // Validate thresholds with zod (E2 / R8)
      const configValidation = thresholdSchema.safeParse(parsedConfig);
      if (!configValidation.success) {
        toast.error(configValidation.error.errors[0].message);
        setIsSaving(false);
        return;
      }

      // Check for changes and log (R8)
      const changes: string[] = [];
      if (config.lowLevelThreshold !== parsedConfig.lowLevelThreshold) {
        changes.push(`Low Level (${config.lowLevelThreshold}% -> ${parsedConfig.lowLevelThreshold}%)`);
      }
      if (config.overflowThreshold !== parsedConfig.overflowThreshold) {
        changes.push(`Overflow (${config.overflowThreshold}% -> ${parsedConfig.overflowThreshold}%)`);
      }
      if (config.minPh !== parsedConfig.minPh) {
        changes.push(`Min pH (${config.minPh} -> ${parsedConfig.minPh})`);
      }
      if (config.maxPh !== parsedConfig.maxPh) {
        changes.push(`Max pH (${config.maxPh} -> ${parsedConfig.maxPh})`);
      }
      if (config.offlineThresholdSec !== parsedConfig.offlineThresholdSec) {
        changes.push(`Offline Watchdog (${config.offlineThresholdSec || 30}s -> ${parsedConfig.offlineThresholdSec}s)`);
      }
      if (config.repeatIntervalSec !== parsedConfig.repeatIntervalSec) {
        changes.push(`Repeat Interval (${config.repeatIntervalSec || 60}s -> ${parsedConfig.repeatIntervalSec}s)`);
      }
      const savedNight = nightSettings(config);
      if (savedNight.enabled !== parsedConfig.nightWatchEnabled) {
        changes.push(`Night Watch (${savedNight.enabled ? 'On' : 'Off'} -> ${parsedConfig.nightWatchEnabled ? 'On' : 'Off'})`);
      }
      if (savedNight.startHour !== parsedConfig.nightStartHour || savedNight.endHour !== parsedConfig.nightEndHour) {
        changes.push(`Night Hours (${formatHour12(savedNight.startHour)}-${formatHour12(savedNight.endHour)} -> ${formatHour12(parsedConfig.nightStartHour ?? 0)}-${formatHour12(parsedConfig.nightEndHour ?? 0)})`);
      }
      if (savedNight.fastDrop !== parsedConfig.nightFastDropPercent) {
        changes.push(`Night Fast Drop (${savedNight.fastDrop}% -> ${parsedConfig.nightFastDropPercent}%)`);
      }
      if (savedNight.slowDrop !== parsedConfig.nightSlowDropPercent) {
        changes.push(`Night Total Drop (${savedNight.slowDrop}% -> ${parsedConfig.nightSlowDropPercent}%)`);
      }
      if (config.soundEnabled !== parsedConfig.soundEnabled) {
        changes.push(`Sound Alerts (${config.soundEnabled !== false ? 'Enabled' : 'Disabled'} -> ${parsedConfig.soundEnabled ? 'Enabled' : 'Disabled'})`);
      }

      // pumpMode is written only by its own toggle; a form left open with edits must not revert it
      const configUpdate: Partial<SystemConfig> = { ...parsedConfig };
      delete configUpdate.pumpMode;
      await updateConfig(configUpdate);
      setIsConfigDirty(false);

      if (changes.length > 0) {
        addLog({
          action: 'Configuration Updated',
          details: `Updated system thresholds: ${changes.join(', ')}`,
          performedBy: currentUser?.username || 'Administrator',
          logLevel: 'INFO'
        });
      }

      if (localTank) {
        // B9: Send only calibration fields to avoid overwriting live telemetry / pump commands
        const calibrationUpdates: Partial<Tank> = {
          levelVmin: Number(localTank.levelVmin),
          levelVmax: Number(localTank.levelVmax),
          tankHeight: Number(localTank.tankHeight),
          capacityLiters: Number(localTank.capacityLiters),
          levelOffset: Number(localTank.levelOffset),
          phNeutralVoltage: Number(localTank.phNeutralVoltage),
          phSlope: Number(localTank.phSlope),
          phOffset: Number(localTank.phOffset),
        };

        const calibValidation = calibrationSchema.safeParse(calibrationUpdates);
        if (!calibValidation.success) {
          toast.error(calibValidation.error.errors[0].message);
          setIsSaving(false);
          return;
        }

        // Log which calibration values changed, like the threshold changes above
        type CalibrationKey = 'levelVmin' | 'levelVmax' | 'tankHeight' | 'capacityLiters' | 'levelOffset' | 'phNeutralVoltage' | 'phSlope' | 'phOffset';
        const calibrationLabels: Record<CalibrationKey, string> = {
          levelVmin: 'Level Vmin', levelVmax: 'Level Vmax', tankHeight: 'Tank Height',
          capacityLiters: 'Tank Capacity (L)',
          levelOffset: 'Level Offset', phNeutralVoltage: 'pH Neutral Voltage',
          phSlope: 'pH Slope', phOffset: 'pH Offset',
        };
        const calibrationChanges = (Object.keys(calibrationLabels) as CalibrationKey[])
          .filter(key => selectedTank?.[key] !== calibrationUpdates[key])
          .map(key => `${calibrationLabels[key]} (${selectedTank?.[key] ?? 'unset'} -> ${calibrationUpdates[key]})`);

        await updateTank(selectedTankId, calibrationUpdates);
        setIsTankDirty(false);

        if (calibrationChanges.length > 0) {
          addLog({
            action: 'Calibration Updated',
            details: `Updated sensor calibration for ${selectedTank?.name ?? selectedTankLabel}: ${calibrationChanges.join(', ')}`,
            performedBy: currentUser?.username || 'Administrator',
            logLevel: 'INFO'
          });
        }
      }
      
      toast.success('System configuration and sensor calibrations saved successfully!');
      setShowSaveConfirm(false);
    } catch (err) {
      toast.error(errorMessage(err) || 'Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  };

  if (!localConfig) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-2 bg-card rounded-xl shadow-sm">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
        <p className="text-sm font-medium">Loading system configurations...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">Reservoir Settings</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Low-Level Threshold (%)</label>
            <input 
              type="number" 
              value={localConfig.lowLevelThreshold} 
              onChange={e => { setIsConfigDirty(true); setLocalConfig({ ...localConfig, lowLevelThreshold: e.target.value }); }}
              className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background" 
            />
            <p className="text-xs text-muted-foreground mt-1">Alert when water level falls below this percentage</p>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Overflow-Level Threshold (%)</label>
            <input 
              type="number" 
              value={localConfig.overflowThreshold} 
              onChange={e => { setIsConfigDirty(true); setLocalConfig({ ...localConfig, overflowThreshold: e.target.value }); }}
              className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background" 
            />
            <p className="text-xs text-muted-foreground mt-1">Alert when water level exceeds this percentage</p>
          </div>
        </div>

        <h4 className="font-semibold mt-6 mb-3">pH Safe Range</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Minimum pH</label>
            <input 
              type="number" 
              step="0.1" 
              value={localConfig.minPh} 
              onChange={e => { setIsConfigDirty(true); setLocalConfig({ ...localConfig, minPh: e.target.value }); }}
              className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background" 
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Maximum pH</label>
            <input 
              type="number" 
              step="0.1" 
              value={localConfig.maxPh} 
              onChange={e => { setIsConfigDirty(true); setLocalConfig({ ...localConfig, maxPh: e.target.value }); }}
              className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background" 
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">Safe pH range: {localConfig.minPh} - {localConfig.maxPh}</p>
      </div>

      <div className="rounded-xl bg-card p-6 shadow-sm border border-border">
        <div role="tablist" aria-label="Tank to calibrate" className="mb-4 flex flex-wrap gap-2">
          {tankIds.map(id => {
            const active = id === selectedTankId;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => handleSelectTank(id)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-secondary'
                }`}
              >
                Tank {id}
              </button>
            );
          })}
        </div>
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Settings size={18} className="text-primary" /> Sensor Calibration & Offsets ({selectedTankLabel})
        </h3>

        {localTank ? (
          <div className="space-y-6">
            {selectedTank && (
              <LiveCalibrationPanel
                tank={selectedTank}
                canEdit={isAdmin}
                onUseValue={(field, value) => {
                  setIsTankDirty(true);
                  setLocalTank(prev => (prev ? { ...prev, [field]: value } : prev));
                  toast.info(`Filled in ${value.toFixed(3)} V. Press Save to apply it.`);
                }}
              />
            )}
            <div>
              <h4 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wider">Water Level Sensor Calibration</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">Vmin (Empty Tank Voltage)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={localTank.levelVmin ?? ''}
                    onChange={e => { setIsTankDirty(true); setLocalTank({ ...localTank, levelVmin: e.target.value }); }}
                    className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Voltage when tank is 0% full</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Vmax (Full Tank Voltage)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={localTank.levelVmax ?? ''}
                    onChange={e => { setIsTankDirty(true); setLocalTank({ ...localTank, levelVmax: e.target.value }); }}
                    className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Voltage when tank is 100% full</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Physical Tank Height (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={localTank.tankHeight ?? ''}
                    onChange={e => { setIsTankDirty(true); setLocalTank({ ...localTank, tankHeight: e.target.value }); }}
                    className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Height of reservoir in meters</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Tank Capacity (L)</label>
                  <input
                    type="number"
                    step="1"
                    min={1}
                    value={localTank.capacityLiters ?? ''}
                    onChange={e => { setIsTankDirty(true); setLocalTank({ ...localTank, capacityLiters: e.target.value }); }}
                    className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Full volume, used for the estimated volume</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Reading Offset (%)</label>
                  <input
                    type="number"
                    step="1"
                    value={localTank.levelOffset ?? ''}
                    onChange={e => { setIsTankDirty(true); setLocalTank({ ...localTank, levelOffset: e.target.value }); }}
                    className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Adjustment offset (+/- %)</p>
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <h4 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wider">pH Sensor Calibration</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">Neutral Reference Voltage (V)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={localTank.phNeutralVoltage ?? ''}
                    onChange={e => { setIsTankDirty(true); setLocalTank({ ...localTank, phNeutralVoltage: e.target.value }); }}
                    className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Voltage at pH 7.00 (typically 2.5V)</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Slope Sensitivity (V/pH)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={localTank.phSlope ?? ''}
                    onChange={e => { setIsTankDirty(true); setLocalTank({ ...localTank, phSlope: e.target.value }); }}
                    className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Voltage step per pH unit (default 0.18)</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Reading Offset (pH)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={localTank.phOffset ?? ''}
                    onChange={e => { setIsTankDirty(true); setLocalTank({ ...localTank, phOffset: e.target.value }); }}
                    className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Adjustment offset (+/- pH)</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{selectedTankLabel} calibration data is loading...</p>
        )}
      </div>

      <DeviceAccounts />

      <div className="rounded-xl bg-card p-6 shadow-sm border border-border">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Bell size={18} className="text-primary" /> Notification & Watchdog Settings
        </h3>
        <div
          data-testid="alert-service-status"
          className={`mb-4 rounded-lg border px-3 py-2 text-xs font-medium ${
            workerStatus.active
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
              : 'border-warning/40 bg-warning/10 text-foreground'
          }`}
        >
          {workerStatus.active
            ? 'Alert service: running. Alerts and push notifications work even when no dashboard is open.'
            : 'Alert service: not running. Alerts are evaluated only while a dashboard is open, and push notifications are not sent.'}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Offline Watchdog Threshold (s)</label>
            <input 
              type="number" 
              min={20}
              value={localConfig.offlineThresholdSec ?? 30} 
              onChange={e => { setIsConfigDirty(true); setLocalConfig({ ...localConfig, offlineThresholdSec: Number(e.target.value) }); }}
              className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background" 
            />
            <p className="text-xs text-muted-foreground mt-1">Raise offline alert if controller heartbeats cease for &ge; this time (min: 20s)</p>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Alert Repeat Interval (s)</label>
            <input 
              type="number" 
              min={10}
              value={localConfig.repeatIntervalSec ?? 60} 
              onChange={e => { setIsConfigDirty(true); setLocalConfig({ ...localConfig, repeatIntervalSec: Number(e.target.value) }); }}
              className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background" 
            />
            <p className="text-xs text-muted-foreground mt-1">How often an unacknowledged alert is shown again (min: 10s)</p>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">System-Wide Alert Sound</label>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsConfigDirty(true);
                  setLocalConfig({ ...localConfig, soundEnabled: localConfig.soundEnabled === false ? true : false });
                }}
                className={`relative h-6 w-11 rounded-full transition-colors shrink-0 ${localConfig.soundEnabled !== false ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${localConfig.soundEnabled !== false ? 'translate-x-5' : ''}`} />
              </button>
              <span className="text-sm font-medium">
                {localConfig.soundEnabled !== false ? 'Audio Enabled' : 'Audio Disabled'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Continuous alarm audio chime for critical alerts</p>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Push Notifications</label>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsConfigDirty(true);
                  setLocalConfig({ ...localConfig, pushEnabled: localConfig.pushEnabled === false ? true : false });
                }}
                className={`relative h-6 w-11 rounded-full transition-colors shrink-0 ${localConfig.pushEnabled !== false ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${localConfig.pushEnabled !== false ? 'translate-x-5' : ''}`} />
              </button>
              <span className="text-sm font-medium">
                {localConfig.pushEnabled !== false ? 'Push Enabled' : 'Push Disabled'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Sent by the alert service to phones and browsers that enabled push</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-card p-6 shadow-sm border border-border" data-testid="night-watch-settings">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Moon size={18} className="text-primary" /> Night Watch (Leak Detection)
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              No water should be used during these hours (Philippine time). If a tank loses water then, everyone gets a
              &quot;Possible Leak or Open Faucet&quot; alert. Readings while the pump runs, during a level sensor fault or during
              live calibration are ignored.
            </p>
          </div>
          <button
            type="button"
            aria-label="Night Watch"
            onClick={() => {
              setIsConfigDirty(true);
              setLocalConfig({ ...localConfig, nightWatchEnabled: localConfig.nightWatchEnabled === false });
            }}
            className={`relative h-6 w-11 rounded-full transition-colors shrink-0 ${localConfig.nightWatchEnabled !== false ? 'bg-primary' : 'bg-muted'}`}
          >
            <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${localConfig.nightWatchEnabled !== false ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        <div className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 ${localConfig.nightWatchEnabled === false ? 'opacity-50' : ''}`}>
          <div>
            <label htmlFor="night-start" className="block text-sm font-semibold mb-1">Starts at</label>
            <select
              id="night-start"
              value={localConfig.nightStartHour ?? night.startHour}
              onChange={e => { setIsConfigDirty(true); setLocalConfig({ ...localConfig, nightStartHour: Number(e.target.value) }); }}
              className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
            >
              {HOURS.map(h => <option key={h} value={h}>{formatHour12(h)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="night-end" className="block text-sm font-semibold mb-1">Ends at</label>
            <select
              id="night-end"
              value={localConfig.nightEndHour ?? night.endHour}
              onChange={e => { setIsConfigDirty(true); setLocalConfig({ ...localConfig, nightEndHour: Number(e.target.value) }); }}
              className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
            >
              {HOURS.map(h => <option key={h} value={h}>{formatHour12(h)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="night-fast" className="block text-sm font-semibold mb-1">Fast Drop (%)</label>
            <input
              id="night-fast"
              type="number"
              min={MIN_NIGHT_DROP_PERCENT}
              value={localConfig.nightFastDropPercent ?? night.fastDrop}
              onChange={e => { setIsConfigDirty(true); setLocalConfig({ ...localConfig, nightFastDropPercent: e.target.value }); }}
              className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
            />
            <p className="text-xs text-muted-foreground mt-1">Alert right away if the level falls this much within {NIGHT_FAST_WINDOW_MS / 60_000} min (open faucet)</p>
          </div>
          <div>
            <label htmlFor="night-slow" className="block text-sm font-semibold mb-1">Total Night Drop (%)</label>
            <input
              id="night-slow"
              type="number"
              min={MIN_NIGHT_DROP_PERCENT}
              value={localConfig.nightSlowDropPercent ?? night.slowDrop}
              onChange={e => { setIsConfigDirty(true); setLocalConfig({ ...localConfig, nightSlowDropPercent: e.target.value }); }}
              className="w-full rounded-lg border border-input px-3 py-2 text-sm bg-background"
            />
            <p className="text-xs text-muted-foreground mt-1">Warn when the night ends if the level fell this much in total (slow leak)</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">System Controls</h3>
        <div className="space-y-4">
          <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border ${isPumpDemoOn(localConfig as SystemConfig) ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
            <div className="flex items-center gap-3">
              <Power size={18} className={isPumpDemoOn(localConfig as SystemConfig) ? 'text-primary' : 'text-muted-foreground'} />
              <div>
                <p className="font-medium text-sm">Pump System</p>
                <p className="text-xs text-muted-foreground">Shows the pump controls and lets the controller run the pump</p>
                {!isPumpDemoOn(localConfig as SystemConfig) && <p className="text-xs text-muted-foreground font-medium mt-1">Off: pump controls are hidden and the controller keeps the pump off</p>}
              </div>
            </div>
            <button onClick={() => handleToggle('pumpDemoMode', 'Pump System')}
              aria-label="Pump System"
              className={`relative h-6 w-11 rounded-full transition-colors shrink-0 self-end sm:self-auto ${isPumpDemoOn(localConfig as SystemConfig) ? 'bg-primary' : 'bg-muted'}`}>
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${isPumpDemoOn(localConfig as SystemConfig) ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          {isAdmin && isPumpDemoOn(config) && (() => {
            const mode = getPumpMode(config);
            return (
              <div data-testid="pump-mode-setting" className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border ${mode === 'manual' ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
                <div className="flex items-center gap-3">
                  <Hand size={18} className={mode === 'manual' ? 'text-primary' : 'text-muted-foreground'} />
                  <div>
                    <p className="font-medium text-sm">Pump Mode</p>
                    <p className="text-xs text-muted-foreground">
                      {mode === 'manual'
                        ? 'Manual: only pump commands start the pump. Overflow, sensor fault and maintenance stops still apply.'
                        : 'Auto: the controller starts the pump when the level falls to the low threshold.'}
                    </p>
                  </div>
                </div>
                <div role="radiogroup" aria-label="Pump Mode" className="flex rounded-lg border border-border overflow-hidden shrink-0 self-end sm:self-auto">
                  {(['auto', 'manual'] as const).map(option => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={mode === option}
                      onClick={() => { if (mode !== option) setModeConfirm(option); }}
                      className={`px-3 py-1.5 text-sm font-semibold transition ${mode === option ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground hover:bg-secondary'}`}
                    >
                      {option === 'auto' ? 'Auto' : 'Manual'}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
          <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border ${localConfig.maintenanceMode ? 'border-warning bg-warning/5' : 'border-border'}`}>
            <div className="flex items-center gap-3">
              <Settings size={18} className={localConfig.maintenanceMode ? 'text-warning' : 'text-muted-foreground'} />
              <div>
                <p className="font-medium text-sm">Maintenance Mode (all tanks)</p>
                <p className="text-xs text-muted-foreground">{isPumpDemoOn(localConfig as SystemConfig) ? 'Suppresses alerts system-wide and stops the pump' : 'Suppresses alerts system-wide'}</p>
                {localConfig.maintenanceMode && <p className="text-xs text-warning font-medium mt-1">⚠️ Currently active — alerts are suppressed{isPumpDemoOn(localConfig as SystemConfig) ? ' and the pump is locked' : ''}</p>}
              </div>
            </div>
            <button onClick={() => handleToggle('maintenanceMode', 'Maintenance Mode')}
              className={`relative h-6 w-11 rounded-full transition-colors shrink-0 self-end sm:self-auto ${localConfig.maintenanceMode ? 'bg-warning' : 'bg-muted'}`}>
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${localConfig.maintenanceMode ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          {isAdmin && (
            <div data-testid="tank-maintenance-settings" className="p-4 rounded-lg border border-border">
              <div className="flex items-center gap-3">
                <Wrench size={18} className="text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm">Tank Maintenance</p>
                  <p className="text-xs text-muted-foreground">
                    Put one tank under maintenance: only its alerts and offline notice are paused{isPumpDemoOn(localConfig as SystemConfig) ? ' and only its pump is held off' : ''}. The other tanks keep working.
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {tankIds.map(tankId => {
                  const tank = tanks.find(t => t.id === tankId);
                  const label = tank?.name || `Tank ${tankId}`;
                  const on = tank?.maintenanceMode === true;
                  return (
                    <div key={tankId} className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border ${on ? 'border-warning bg-warning/5' : 'border-border'}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{label}</p>
                        <p className={`text-xs ${on ? 'text-warning font-medium' : 'text-muted-foreground'}`}>{on ? 'Under maintenance' : 'Normal'}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`Maintenance for ${label}`}
                        disabled={!tank}
                        onClick={() => setTankMaintenanceConfirm({ tankId, label, newState: !on })}
                        className={`relative h-6 w-11 rounded-full transition-colors shrink-0 disabled:opacity-50 ${on ? 'bg-warning' : 'bg-muted'}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {isPumpDemoOn(localConfig as SystemConfig) && (
          <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border ${localConfig.pumpControlLock ? 'border-danger bg-danger/5' : 'border-border'}`}>
            <div className="flex items-center gap-3">
              <Power size={18} className={localConfig.pumpControlLock ? 'text-danger' : 'text-muted-foreground'} />
              <div>
                <p className="font-medium text-sm">Pump Control Lock</p>
                <p className="text-xs text-muted-foreground">Locks all pump controls for workers — admins can still toggle pumps</p>
                {localConfig.pumpControlLock && <p className="text-xs text-danger font-medium mt-1">🔒 Active — workers cannot control pumps</p>}
              </div>
            </div>
            <button onClick={() => handleToggle('pumpControlLock', 'Pump Control Lock')}
              className={`relative h-6 w-11 rounded-full transition-colors shrink-0 self-end sm:self-auto ${localConfig.pumpControlLock ? 'bg-danger' : 'bg-muted'}`}>
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${localConfig.pumpControlLock ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          )}
        </div>
      </div>

      <button disabled={isSaving} onClick={() => setShowSaveConfirm(true)} className="w-full rounded-lg bg-primary py-3 font-semibold text-primary-foreground hover:opacity-90 transition flex items-center justify-center gap-2">
        <Settings size={16} /> Save All Configurations
      </button>

      {/* Save All Configurations Confirmation Modal */}
      {showSaveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border/40 rounded-xl p-6 shadow-xl max-w-md w-full mx-4 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-primary mb-2">
              <Settings size={24} className="text-primary animate-spin-slow" />
              <h4 className="text-lg font-bold text-foreground">Confirm System Configurations</h4>
            </div>
            
            <div className="text-sm text-muted-foreground space-y-3">
              <p>
                Are you sure you want to write these new system settings and telemetry calibrations to the active database?
              </p>
              <div className="bg-secondary/40 p-3 rounded-lg text-xs space-y-1.5 border border-border/50 font-medium text-foreground/80">
                <p>📊 <strong>Water Level Thresholds:</strong> Low: {localConfig.lowLevelThreshold}% | Overflow: {localConfig.overflowThreshold}%</p>
                <p>🧪 <strong>pH Safety Range:</strong> Min: {localConfig.minPh} | Max: {localConfig.maxPh}</p>
                <p>🌙 <strong>Night Watch:</strong> {localConfig.nightWatchEnabled === false ? 'Off' : `${formatHour12(Number(localConfig.nightStartHour ?? night.startHour))} to ${formatHour12(Number(localConfig.nightEndHour ?? night.endHour))} | Fast: ${localConfig.nightFastDropPercent ?? night.fastDrop}% in ${NIGHT_FAST_WINDOW_MS / 60_000} min | Total: ${localConfig.nightSlowDropPercent ?? night.slowDrop}%`}</p>
                <p>🔔 <strong>Watchdog & Sound:</strong> Offline: {localConfig.offlineThresholdSec ?? 30}s | Repeat: {localConfig.repeatIntervalSec ?? 60}s | Audio: {localConfig.soundEnabled !== false ? 'Enabled' : 'Disabled'}</p>
                {localTank && (
                  <p>⚙️ <strong>Sensor Calibrations ({selectedTankLabel}):</strong> Vmin: {localTank.levelVmin}V | Vmax: {localTank.levelVmax}V | Height: {localTank.tankHeight}m | Capacity: {localTank.capacityLiters} L</p>
                )}
              </div>
              <p className="text-xs text-danger font-medium">
                ⚠️ Malformed calibration coefficients or threshold parameters can disrupt automatic pump triggers and trigger false-alarm telemetry notifications.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                disabled={isSaving}
                onClick={() => setShowSaveConfirm(false)}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={isSaving}
                onClick={handleSaveAll}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Applying...
                  </>
                ) : (
                  'Confirm & Apply'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingTankId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div role="alertdialog" aria-labelledby="discard-calibration-title" className="bg-card rounded-xl p-6 shadow-lg max-w-sm w-full mx-4 border border-border/40 space-y-4 animate-in zoom-in-95 duration-200">
            <h4 id="discard-calibration-title" className="text-lg font-semibold">Discard unsaved changes?</h4>
            <p className="text-sm text-muted-foreground">
              The calibration changes for {selectedTankLabel} have not been saved. Switch to Tank {pendingTankId} and discard them?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setPendingTankId(null)} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition text-foreground">Keep Editing</button>
              <button onClick={() => switchTank(pendingTankId)} className="flex-1 rounded-lg bg-danger px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 transition">
                Discard Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {modeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div role="alertdialog" aria-labelledby="pump-mode-title" className="bg-card rounded-xl p-6 shadow-lg max-w-sm w-full mx-4 border border-border/40 space-y-4 animate-in zoom-in-95 duration-200">
            <h4 id="pump-mode-title" className="text-lg font-semibold">Switch to {modeConfirm === 'manual' ? 'Manual' : 'Auto'} pump mode</h4>
            <p className="text-sm text-muted-foreground">
              {modeConfirm === 'manual'
                ? 'The controller will stop starting the pump at the low-level threshold. The pump keeps its current state; only pump commands switch it. Overflow, sensor fault and maintenance stops still apply.'
                : 'The controller resumes the automatic rules: if the level is at or below the low threshold, the pump may start after the 30 s cooldown.'}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setModeConfirm(null)} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition text-foreground">Cancel</button>
              <button onClick={confirmPumpMode} className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 transition">
                Switch to {modeConfirm === 'manual' ? 'Manual' : 'Auto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tankMaintenanceConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div role="alertdialog" aria-labelledby="tank-maintenance-title" className="bg-card rounded-xl p-6 shadow-lg max-w-sm w-full mx-4 border border-border/40 space-y-4 animate-in zoom-in-95 duration-200">
            <h4 id="tank-maintenance-title" className="text-lg font-semibold">{tankMaintenanceConfirm.newState ? 'Enable' : 'Disable'} maintenance for {tankMaintenanceConfirm.label}</h4>
            <p className="text-sm text-muted-foreground">
              {tankMaintenanceConfirm.newState
                ? `Alerts and the offline notice for ${tankMaintenanceConfirm.label} will be paused${isPumpDemoOn(config) ? ', and its controller will stop the pump and refuse pump commands' : ''}. The other tanks are not affected.`
                : `${tankMaintenanceConfirm.label} returns to normal: its alerts${isPumpDemoOn(config) ? ' and pump controls' : ''} are enabled again.`}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setTankMaintenanceConfirm(null)} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition text-foreground">Cancel</button>
              <button onClick={confirmTankMaintenance} className={`flex-1 rounded-lg px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 transition ${tankMaintenanceConfirm.newState ? 'bg-danger' : 'bg-safe'}`}>
                {tankMaintenanceConfirm.newState ? 'Enable' : 'Disable'}
              </button>
            </div>
          </div>
        </div>
      )}

      {controlConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card rounded-xl p-6 shadow-lg max-w-sm w-full mx-4 border border-border/40 space-y-4 animate-in zoom-in-95 duration-200">
            <h4 className="text-lg font-semibold">{controlConfirm.newState ? 'Enable' : 'Disable'} {controlConfirm.label}</h4>
            <p className="text-sm text-muted-foreground">
              {controlConfirm.key === 'maintenanceMode' && controlConfirm.newState && 'This will suppress all alerts system-wide and stop the pump. No one will be able to toggle it.'}
              {controlConfirm.key === 'maintenanceMode' && !controlConfirm.newState && 'This will restore normal operations. Alerts (and the pump controls) will be re-enabled.'}
              {controlConfirm.key === 'pumpDemoMode' && controlConfirm.newState && 'This will show the pump controls on every dashboard, in Reports and in exports, and let the controller run the pump.'}
              {controlConfirm.key === 'pumpDemoMode' && !controlConfirm.newState && 'This will hide all pump controls, reports and export sections. The controller keeps the pump off and refuses pump commands.'}
              {controlConfirm.key === 'pumpControlLock' && controlConfirm.newState && 'This will lock all pump controls for workers. Only admins will be able to toggle pumps.'}
              {controlConfirm.key === 'pumpControlLock' && !controlConfirm.newState && 'This will unlock pump controls. Assigned workers will be able to toggle their tank pumps again.'}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setControlConfirm(null)} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition text-foreground">Cancel</button>
              <button onClick={confirmToggle} className={`flex-1 rounded-lg px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 transition ${controlConfirm.newState ? 'bg-danger' : 'bg-safe'}`}>
                {controlConfirm.newState ? 'Enable' : 'Disable'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Configuration;
