import { useState, useEffect } from 'react';
import { addSystemLog } from '@/store/useStore';
import { Cpu } from 'lucide-react';
import { database } from '@/config/firebase';
import { ref, onValue } from 'firebase/database';
import { grantDeviceRole, revokeDeviceRole } from '@/services/authService';
import { toast } from 'sonner';

/**
 * Device Accounts card.
 * Database rules only accept telemetry from Firebase Auth accounts holding the
 * 'device' role, so each ESP32 controller account must be registered here once.
 */
const DeviceAccounts = () => {
  const [deviceUids, setDeviceUids] = useState<string[]>([]);
  const [uidInput, setUidInput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = onValue(
      ref(database, 'roles'),
      (snapshot) => {
        const data = (snapshot.val() || {}) as Record<string, string>;
        setDeviceUids(Object.keys(data).filter((uid) => data[uid] === 'device'));
      },
      (error) => console.error('Error reading device roles:', error)
    );
    return () => unsubscribe();
  }, []);

  const handleGrant = async () => {
    setBusy(true);
    try {
      await grantDeviceRole(uidInput);
      addSystemLog({
        action: 'Device Account Registered',
        details: `Controller account ${uidInput.trim()} was granted the device role.`,
        performedBy: 'Admin',
        logLevel: 'INFO',
      });
      toast.success('Controller account registered.');
      setUidInput('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to register controller account');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (uid: string) => {
    if (!window.confirm(`Remove device access for ${uid}? That controller will stop reporting until it is registered again.`)) return;
    try {
      await revokeDeviceRole(uid);
      addSystemLog({
        action: 'Device Account Removed',
        details: `Controller account ${uid} lost the device role.`,
        performedBy: 'Admin',
        logLevel: 'WARNING',
      });
      toast.success('Controller account removed.');
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove controller account');
    }
  };

  return (
    <div className="rounded-xl bg-card p-6 shadow-sm border border-border">
      <h3 className="text-lg font-semibold mb-1 flex items-center gap-2">
        <Cpu size={18} className="text-primary" /> Controller (ESP32) Accounts
      </h3>
      <p className="text-xs text-muted-foreground mb-4">
        Only registered controller accounts can send telemetry. Paste the account's User UID from
        Firebase console &gt; Authentication &gt; Users.
      </p>
      {deviceUids.length === 0 ? (
        <p className="text-sm font-medium text-danger mb-3">
          No controller account is registered. The ESP32 cannot write readings until one is added.
        </p>
      ) : (
        <ul className="space-y-2 mb-3">
          {deviceUids.map((uid) => (
            <li key={uid} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="font-mono text-xs break-all">{uid}</span>
              <button onClick={() => handleRevoke(uid)} className="text-xs font-semibold text-danger hover:underline shrink-0">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          placeholder="Controller account UID"
          value={uidInput}
          onChange={(e) => setUidInput(e.target.value)}
          className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
        />
        <button
          onClick={handleGrant}
          disabled={busy || !uidInput.trim()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
        >
          Register controller
        </button>
      </div>
    </div>
  );
};

export default DeviceAccounts;
