import { useState, useEffect } from 'react';
import { UserPlus, Power, WifiOff, Settings } from 'lucide-react';
import { firestore } from '@/config/firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { registerOperator, updateUserProfile, deleteUserProfile, type UserProfile } from '@/services/authService';
import UserManagement, { type NewOperator } from './admin/UserManagement';
import TankAssignment from './admin/TankAssignment';
import Configuration from './admin/Configuration';

/**
 * Custom React hook local to the Admin Panel for listening to the users collection in Firestore.
 */
function useFirestoreUsers() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(firestore, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: UserProfile[] = [];
      snapshot.forEach((doc) => {
        list.push({ ...(doc.data() as UserProfile), id: doc.id });
      });
      setUsers(list);
      setLoading(false);
    }, (error) => {
      console.error("Error listening to Firestore users:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addUser = async (user: NewOperator) => {
    return await registerOperator(user.email, user.password, user.name, user.role, user.jobTitle);
  };

  const updateUser = async (id: string, updates: Partial<UserProfile>) => {
    await updateUserProfile(id, updates);
  };

  const deleteUser = async (id: string) => {
    await deleteUserProfile(id);
  };

  return { users, loading, addUser, updateUser, deleteUser };
}

const AdminPanel = () => {
  const [activeTab, setActiveTab] = useState<'users' | 'tanks' | 'config'>('users');
  const { users, loading, addUser, updateUser, deleteUser } = useFirestoreUsers();

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-primary">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">System administration and configuration</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <WifiOff size={14} /> Cloud Secured (Firestore)
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b border-border overflow-x-auto scrollbar-none whitespace-nowrap">
        {[
          { key: 'users' as const, label: 'User Management', icon: <UserPlus size={14} /> },
          { key: 'tanks' as const, label: 'Tank Assignment', icon: <Power size={14} /> },
          { key: 'config' as const, label: 'Configuration', icon: <Settings size={14} /> },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors shrink-0 ${activeTab === tab.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'users' && <UserManagement users={users} loading={loading} addUser={addUser} updateUser={updateUser} deleteUser={deleteUser} />}
      {activeTab === 'tanks' && <TankAssignment users={users} />}
      {activeTab === 'config' && <Configuration />}
    </div>
  );
};

export default AdminPanel;
