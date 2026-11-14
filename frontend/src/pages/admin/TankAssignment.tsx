import { useState } from 'react';
import { useTanks, isTankPlanned, Tank } from '@/store/useStore';
import { Trash2, Power, Loader2, Plus, Edit } from 'lucide-react';
import { toast } from 'sonner';
import type { UserProfile } from '@/services/authService';
import { errorMessage } from '@/lib/utils';
import { SUPPORTED_TANK_IDS, isSupportedTankId } from '@/lib/constants';

interface TankAssignmentProps {
  users: UserProfile[];
}

const TankAssignment = ({ users }: TankAssignmentProps) => {
  const { tanks, updateTank, addTank, deleteTank } = useTanks();
  // Include only active worker accounts in the operators listing
  const workers = users.filter(u => u.role === 'worker' && u.status === 'active');
  // Only Tanks 1–4 can be registered, and only the ones missing from the database
  const freeTankIds = SUPPORTED_TANK_IDS.filter(id => !tanks.some(t => t.id === id));

  // Modal and Form States for CRUD
  const [showAddTank, setShowAddTank] = useState(false);
  const [newTankData, setNewTankData] = useState({ id: '', name: '', location: '' });
  const [isAddingTank, setIsAddingTank] = useState(false);
  const [addTankError, setAddTankError] = useState('');

  const [editingTank, setEditingTank] = useState<Tank | null>(null);
  const [editTankData, setEditTankData] = useState({ name: '', location: '' });
  const [isEditingTank, setIsEditingTank] = useState(false);

  const [deletingTank, setDeletingTank] = useState<Tank | null>(null);
  const [isDeletingTank, setIsDeletingTank] = useState(false);

  const handleWorkerChange = async (tankId: string, workerId: string | null) => {
    try {
      await updateTank(tankId, { assignedWorker: workerId });
      toast.success(workerId ? 'Operator assigned successfully!' : 'Tank unassigned successfully!');
    } catch (err) {
      toast.error(errorMessage(err) || 'Failed to assign operator');
    }
  };

  const handleToggleEnabled = async (tankId: string, currentEnabled: boolean) => {
    try {
      await updateTank(tankId, {
        enabled: !currentEnabled,
        ...(currentEnabled ? { pumpOn: false, assignedWorker: null } : {})
      });
      toast.success(`Tank successfully ${!currentEnabled ? 'enabled' : 'disabled'}!`);
    } catch (err) {
      toast.error(errorMessage(err) || 'Failed to update tank availability');
    }
  };

  const handleAddTankSubmit = async () => {
    if (!newTankData.id || !newTankData.name) {
      setAddTankError('Please fill in both Tank ID and Name.');
      return;
    }

    if (!isSupportedTankId(newTankData.id)) {
      setAddTankError(`Only Tanks ${SUPPORTED_TANK_IDS.join(', ')} are supported.`);
      return;
    }

    if (tanks.some(t => t.id === newTankData.id)) {
      setAddTankError(`A tank with ID "${newTankData.id}" already exists.`);
      return;
    }

    setIsAddingTank(true);
    try {
      await addTank({
        id: newTankData.id,
        name: newTankData.name,
        location: newTankData.location || 'Unspecified',
        assignedWorker: null,
      });
      toast.success(`Tank "${newTankData.name}" successfully registered!`);
      setShowAddTank(false);
      setNewTankData({ id: '', name: '', location: '' });
    } catch (err) {
      setAddTankError(errorMessage(err) || 'Failed to register tank');
      toast.error(errorMessage(err) || 'Failed to register tank');
    } finally {
      setIsAddingTank(false);
    }
  };

  const handleEditTankSubmit = async () => {
    if (!editingTank) return;
    if (!editTankData.name) {
      toast.error('Tank Name cannot be empty.');
      return;
    }

    setIsEditingTank(true);
    try {
      await updateTank(editingTank.id, {
        name: editTankData.name,
        location: editTankData.location || 'Unspecified'
      });
      toast.success('Tank details successfully updated!');
      setEditingTank(null);
      setEditTankData({ name: '', location: '' });
    } catch (err) {
      toast.error(errorMessage(err) || 'Failed to update tank details');
    } finally {
      setIsEditingTank(false);
    }
  };

  const handleDeleteTankSubmit = async () => {
    if (!deletingTank) return;
    setIsDeletingTank(true);
    try {
      await deleteTank(deletingTank.id);
      toast.success(`Tank "${deletingTank.name}" permanently deleted.`);
      setDeletingTank(null);
    } catch (err) {
      toast.error(errorMessage(err) || 'Failed to delete tank');
    } finally {
      setIsDeletingTank(false);
    }
  };

  return (
    <div className="rounded-xl bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Power size={18} /> Tank Assignment & Management
        </h3>
        <button
          onClick={() => {
            setNewTankData({ id: freeTankIds[0] ?? '', name: freeTankIds[0] ? `Reservoir Tank ${freeTankIds[0]}` : '', location: '' });
            setAddTankError('');
            setShowAddTank(true);
          }}
          disabled={freeTankIds.length === 0}
          title={freeTankIds.length === 0 ? `All supported tanks (${SUPPORTED_TANK_IDS.join(', ')}) are registered` : undefined}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={14} /> Register New Tank
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-3 font-medium">Tank</th>
              <th className="pb-3 font-medium">Location</th>
              <th className="pb-3 font-medium">Current Status</th>
              <th className="pb-3 font-medium">Assigned Operator</th>
              <th className="pb-3 font-medium">Availability</th>
              <th className="pb-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tanks.map(tank => (
              <tr key={tank.id} className={`border-b border-border ${!tank.enabled ? 'opacity-50' : ''}`}>
                <td className="py-4 font-semibold text-foreground">{tank.name} (ID: {tank.id})</td>
                <td className="py-4 text-muted-foreground font-medium">{tank.location || 'Unspecified'}</td>
                <td className="py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                    !tank.enabled ? 'bg-muted text-muted-foreground' :
                    isTankPlanned(tank) ? 'bg-muted text-muted-foreground border border-border' :
                    tank.status === 'warning' ? 'bg-warning/10 text-warning' :
                    tank.status === 'danger' ? 'bg-danger/10 text-danger' :
                    'bg-safe/10 text-safe'
                  }`}>
                    {!tank.enabled ? 'Disabled' : isTankPlanned(tank) ? 'Planned' : tank.status === 'safe' ? 'Safe' : tank.status === 'warning' ? 'Warning' : 'Danger'}
                  </span>
                </td>
                <td className="py-4">
                  <select
                    disabled={!tank.enabled}
                    value={tank.assignedWorker || ''}
                    onChange={e => handleWorkerChange(tank.id, e.target.value || null)}
                    className="rounded-lg border border-input bg-secondary/50 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 text-foreground"
                  >
                    <option value="">Unassigned</option>
                    {workers.map(w => (
                      <option key={w.id} value={w.id}>{w.username} ({w.role === 'admin' ? 'Admin' : w.jobTitle})</option>
                    ))}
                  </select>
                </td>
                <td className="py-4">
                  <span className={`text-sm font-medium ${tank.enabled ? 'text-safe' : 'text-danger'}`}>
                    {tank.enabled ? 'Available' : 'Unavailable'}
                  </span>
                </td>
                <td className="py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleToggleEnabled(tank.id, tank.enabled)}
                      className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${tank.enabled ? 'border-danger/30 text-danger animate-pulse hover:bg-danger/5' : 'border-safe/30 text-safe hover:bg-safe/5'
                        }`}
                    >
                      <Power size={12} /> {tank.enabled ? 'Disable' : 'Enable'}
                    </button>
                    
                    <button
                      onClick={() => { setEditingTank(tank); setEditTankData({ name: tank.name, location: tank.location || '' }); }}
                      className="rounded-lg border border-primary/30 p-1.5 text-primary hover:bg-primary/5"
                      title="Edit Name & Location"
                    >
                      <Edit size={14} />
                    </button>

                    {/* Tanks 1–4 cannot be deleted (the app recreates them); disable them instead */}
                    {!isSupportedTankId(tank.id) ? (
                      <button
                        onClick={() => setDeletingTank(tank)}
                        className="rounded-lg border border-danger/30 p-1.5 text-danger hover:bg-danger/5"
                        title="Delete Tank"
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : (
                      <div className="p-1.5 text-muted-foreground opacity-30 cursor-not-allowed border border-border rounded" title="System tank: cannot be deleted. Use Disable instead.">
                        <Trash2 size={14} />
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Register New Tank Modal */}
      {showAddTank && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border/40 rounded-xl p-6 shadow-xl max-w-md w-full mx-4 space-y-4 animate-in zoom-in-95 duration-200">
            <h4 className="text-lg font-bold text-primary flex items-center gap-2">
              <Plus size={20} /> Register New Tank
            </h4>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Tank ID (Tanks 1–4 only)</label>
                <select
                  value={newTankData.id}
                  onChange={e => {
                    setNewTankData({ ...newTankData, id: e.target.value });
                    setAddTankError('');
                  }}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                >
                  {freeTankIds.map(id => (
                    <option key={id} value={id}>Tank {id}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Tank Name</label>
                <input
                  type="text"
                  placeholder="e.g. Reservoir Tank 2"
                  value={newTankData.name}
                  onChange={e => {
                    setNewTankData({ ...newTankData, name: e.target.value });
                    setAddTankError('');
                  }}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Tank Location</label>
                <input
                  type="text"
                  placeholder="e.g. Sector C, Ground Floor"
                  value={newTankData.location}
                  onChange={e => setNewTankData({ ...newTankData, location: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>
            </div>

            {addTankError && <p className="text-xs text-danger font-semibold">⚠️ {addTankError}</p>}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setShowAddTank(false); setNewTankData({ id: '', name: '', location: '' }); setAddTankError(''); }}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition text-foreground"
              >
                Cancel
              </button>
              <button
                disabled={isAddingTank}
                onClick={handleAddTankSubmit}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition flex items-center justify-center gap-1.5"
              >
                {isAddingTank ? <Loader2 size={16} className="animate-spin" /> : 'Register'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Tank Modal */}
      {editingTank && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border/40 rounded-xl p-6 shadow-xl max-w-md w-full mx-4 space-y-4 animate-in zoom-in-95 duration-200">
            <h4 className="text-lg font-bold text-primary flex items-center gap-2">
              <Edit size={18} /> Edit Tank Location & Name
            </h4>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Tank Name</label>
                <input
                  type="text"
                  placeholder="e.g. Reservoir Tank"
                  value={editTankData.name}
                  onChange={e => setEditTankData({ ...editTankData, name: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Tank Location</label>
                <input
                  type="text"
                  placeholder="e.g. Sector C, Ground Floor"
                  value={editTankData.location}
                  onChange={e => setEditTankData({ ...editTankData, location: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setEditingTank(null); setEditTankData({ name: '', location: '' }); }}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition text-foreground"
              >
                Cancel
              </button>
              <button
                disabled={isEditingTank}
                onClick={handleEditTankSubmit}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition flex items-center justify-center gap-1.5"
              >
                {isEditingTank ? <Loader2 size={16} className="animate-spin" /> : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Tank Modal */}
      {deletingTank && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border/40 rounded-xl p-6 shadow-xl max-w-sm w-full mx-4 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-danger mb-2">
              <Trash2 size={24} className="text-primary animate-pulse" />
              <h4 className="text-lg font-bold text-foreground">Confirm Delete Tank</h4>
            </div>
            
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete <strong>{deletingTank.name}</strong> from the MSU Water Monitoring System?
            </p>
            <p className="text-xs text-danger font-medium">
              ⚠️ This will permanently remove its real-time telemetry node and all database records.
            </p>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setDeletingTank(null)}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary transition text-foreground"
              >
                Cancel
              </button>
              <button
                disabled={isDeletingTank}
                onClick={handleDeleteTankSubmit}
                className="flex-1 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-danger-foreground hover:opacity-90 transition flex items-center justify-center gap-1.5"
              >
                {isDeletingTank ? <Loader2 size={16} className="animate-spin" /> : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TankAssignment;
