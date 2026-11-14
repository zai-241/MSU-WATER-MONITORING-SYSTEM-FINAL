import { useState } from 'react';
import { UserPlus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import type { UserProfile } from '@/services/authService';
import { resolveLoginEmail, isValidEmail } from '@/lib/email';
import { errorMessage } from '@/lib/utils';

export interface NewOperator {
  email: string;
  name: string;
  password: string;
  role: UserProfile['role'];
  jobTitle: string;
}

interface UserManagementProps {
  users: UserProfile[];
  loading: boolean;
  addUser: (user: NewOperator) => Promise<UserProfile>;
  updateUser: (id: string, updates: Partial<UserProfile>) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
}

const UserManagement = ({ users, loading, addUser, updateUser, deleteUser }: UserManagementProps) => {
  const { currentUser } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState({ 
    username: '', 
    email: '', 
    password: '', 
    jobTitle: 'Operator', 
    role: 'worker' as 'admin' | 'worker' | 'viewer' 
  });
  const [isAdding, setIsAdding] = useState(false);
  const [confirmUser, setConfirmUser] = useState<typeof newUser | null>(null);
  const [formError, setFormError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<UserProfile | null>(null);

  const handleAdd = () => {
    if (!newUser.username || !newUser.email || !newUser.password) {
      setFormError('Please fill in all fields');
      return;
    }
    
    const resolvedEmail = resolveLoginEmail(newUser.email);
    if (!isValidEmail(resolvedEmail)) {
      setFormError('Please enter a valid email or username');
      return;
    }

    if (newUser.password.length < 6) {
      setFormError('Password must be at least 6 characters');
      return;
    }

    if (users.some(u => u.email.toLowerCase() === resolvedEmail.toLowerCase())) {
      setFormError('A user with this email or username already exists');
      return;
    }
    
    setFormError('');
    setConfirmUser({
      ...newUser,
      email: resolvedEmail
    });
  };

  const confirmAddUser = async () => {
    if (!confirmUser) return;
    setIsAdding(true);
    try {
      await addUser({ 
        email: confirmUser.email,
        password: confirmUser.password,
        name: confirmUser.username, 
        role: confirmUser.role, 
        jobTitle: confirmUser.role === 'admin' 
          ? 'Administrator' 
          : confirmUser.role === 'viewer' 
            ? 'Viewer' 
            : confirmUser.jobTitle 
      });
      toast.success(`Operator ${confirmUser.username} successfully registered!`);
      setNewUser({ username: '', email: '', password: '', jobTitle: 'Operator', role: 'worker' });
      setConfirmUser(null);
      setShowAdd(false);
    } catch (err) {
      toast.error(errorMessage(err) || 'Failed to register operator');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeactivateToggle = async (userId: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
      await updateUser(userId, { status: newStatus });
      toast.success(`User status successfully updated to ${newStatus}`);
    } catch (err) {
      toast.error(errorMessage(err) || 'Failed to change user status');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await deleteUser(userId);
      toast.success('User account successfully removed');
    } catch (err) {
      toast.error(errorMessage(err) || 'Failed to delete user profile');
    }
  };

  const activeUsers = users.filter(u => u.status === 'active').length;
  const inactiveUsers = users.filter(u => u.status === 'inactive').length;

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Registered Users</h3>
          <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
            <UserPlus size={16} /> Add New User
          </button>
        </div>

        {showAdd && (
          <div className="mb-4 p-4 bg-secondary/50 rounded-lg space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
              <input placeholder="Operator Name" value={newUser.username}
                onChange={e => { setNewUser({ ...newUser, username: e.target.value }); setFormError(''); }}
                className={`rounded-lg border px-3 py-2 text-sm bg-background ${formError ? 'border-danger' : 'border-input'}`} />
              <input placeholder="Email or Username" type="text" value={newUser.email}
                onChange={e => { setNewUser({ ...newUser, email: e.target.value }); setFormError(''); }}
                className={`rounded-lg border px-3 py-2 text-sm bg-background ${formError ? 'border-danger' : 'border-input'}`} />
              <input placeholder="Secure Password" type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                className="rounded-lg border border-input px-3 py-2 text-sm bg-background" />
              <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value as 'admin' | 'worker' | 'viewer' })}
                className="rounded-lg border border-input px-3 py-2 text-sm bg-background">
                <option value="worker">Worker (Operator)</option>
                <option value="viewer">Viewer (Read-Only)</option>
                <option value="admin">Administrator</option>
              </select>
              {newUser.role === 'worker' ? (
                <select value={newUser.jobTitle} onChange={e => setNewUser({ ...newUser, jobTitle: e.target.value })}
                  className="rounded-lg border border-input px-3 py-2 text-sm bg-background">
                  <option>Operator</option><option>Supervisor</option><option>Technician</option>
                </select>
              ) : (
                <div className="rounded-lg border border-input px-3 py-2 text-sm bg-background/50 text-muted-foreground flex items-center justify-center">
                  - N/A -
                </div>
              )}
              <button onClick={handleAdd} className="rounded-lg bg-safe px-4 py-2 text-sm font-semibold text-safe-foreground">Register</button>
            </div>
            {formError && <p className="text-xs text-danger font-medium">⚠️ {formError}</p>}
          </div>
        )}

        {confirmUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50">
            <div className="bg-card rounded-xl p-6 shadow-lg max-w-sm w-full mx-4 space-y-4">
              <h4 className="text-lg font-semibold">Confirm New User</h4>
              <div className="text-sm space-y-1">
                <p><span className="text-muted-foreground">Operator Name:</span> <span className="font-semibold">{confirmUser.username}</span></p>
                <p><span className="text-muted-foreground">Email:</span> <span className="font-semibold">{confirmUser.email}</span></p>
                <p><span className="text-muted-foreground">Role:</span> <span className="font-semibold">
                  {confirmUser.role === 'admin' 
                    ? 'Administrator' 
                    : confirmUser.role === 'viewer' 
                      ? 'Viewer' 
                      : confirmUser.jobTitle}
                </span></p>
              </div>
              <p className="text-xs text-muted-foreground">Are you sure you want to register this user into the secure system?</p>
              <div className="flex gap-3">
                <button disabled={isAdding} onClick={() => setConfirmUser(null)} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary transition disabled:opacity-50">Cancel</button>
                <button disabled={isAdding} onClick={confirmAddUser} className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition flex items-center justify-center gap-1.5 disabled:opacity-50">
                  {isAdding ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Confirm'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-2">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <p className="text-sm font-medium">Synchronizing system operator profiles...</p>
            </div>
          ) : (
            <table className="w-full text-base">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 font-bold text-base">Operator Name</th>
                  <th className="pb-3 font-bold text-base">Email Address</th>
                  <th className="pb-3 font-bold text-base">System Role</th>
                  <th className="pb-3 font-bold text-base">Status</th>
                  <th className="pb-3 font-bold text-base text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id} className="border-b border-border">
                    <td className="py-3 font-bold text-base">{user.username}</td>
                    <td className="py-3 text-base text-muted-foreground font-mono">{user.email}</td>
                    <td className="py-3 font-semibold text-base">
                      <span className={`px-2 py-0.5 rounded text-xs font-extrabold uppercase border ${
                        user.role === 'admin' 
                          ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' 
                          : user.role === 'viewer' 
                            ? 'bg-sky-500/10 text-sky-600 border-sky-500/20' 
                            : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                      }`}>
                        {user.role === 'admin' ? 'Admin' : user.role === 'viewer' ? 'Viewer' : user.jobTitle}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className={`px-2 py-1 rounded-full text-sm font-bold ${user.status === 'active' ? 'bg-safe/10 text-safe' : 'bg-muted text-muted-foreground'
                        }`}>{user.status === 'active' ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(currentUser?.role === 'admin' && user.role !== 'admin' && user.id !== currentUser?.id) ? (
                          <button onClick={() => handleDeactivateToggle(user.id, user.status)}
                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-bold ${user.status === 'active' ? 'border-danger/30 text-danger' : 'border-safe/30 text-safe'
                              }`}>
                            {user.status === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground italic px-2 py-1 bg-secondary/30 rounded border border-border/40">No Permission</span>
                        )}

                        {(currentUser?.role === 'admin' && user.role !== 'admin' && user.id !== currentUser?.id) && (
                          <button onClick={() => setDeleteConfirm(user)} className="rounded-lg border border-danger/30 p-1.5 text-danger">
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50">
            <div className="bg-card rounded-xl p-6 shadow-lg max-w-sm w-full mx-4 space-y-4">
              <h4 className="text-lg font-semibold">Delete User</h4>
              <div className="text-sm space-y-1">
                <p><span className="text-muted-foreground">Operator Name:</span> <span className="font-bold">{deleteConfirm.username}</span></p>
                <p><span className="text-muted-foreground">Email:</span> <span className="font-bold">{deleteConfirm.email}</span></p>
                <p><span className="text-muted-foreground">Role:</span> <span className="font-bold">{deleteConfirm.role === 'admin' ? 'Administrator' : deleteConfirm.jobTitle}</span></p>
              </div>
              <p className="text-sm text-danger font-medium">⚠️ This action cannot be undone. Are you sure you want to delete this user profile?</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary transition">Cancel</button>
                <button onClick={() => { handleDeleteUser(deleteConfirm.id); setDeleteConfirm(null); }} className="flex-1 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-danger-foreground hover:opacity-90 transition">Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">User Statistics</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">Total Users</p>
            <p className="text-2xl font-bold">{users.length}</p>
          </div>
          <div className="rounded-lg border border-safe/30 p-4">
            <p className="text-xs text-safe">Active Users</p>
            <p className="text-2xl font-bold">{activeUsers}</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">Inactive Users</p>
            <p className="text-2xl font-bold">{inactiveUsers}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserManagement;
