import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, update } from 'firebase/database';
import { getAnalytics, isSupported } from "firebase/analytics";
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: "AIzaSyB6p_Po6Al_sQshWOY01tbbq-eFgw4Z0TM",
  authDomain: "msu-water-monitoring-system.firebaseapp.com",
  databaseURL: "https://msu-water-monitoring-system-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "msu-water-monitoring-system",
  storageBucket: "msu-water-monitoring-system.firebasestorage.app",
  messagingSenderId: "423241204607",
  appId: "1:423241204607:web:1ab3ffd28c42608222504a"
};

const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);
export const auth = getAuth(app);
export const firestore = getFirestore(app);

export let analytics: any = null;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {
    // Analytics unsupported in this environment
  });
}

// Example: Read tank data in real-time
export function listenToTank(tankId: string, callback: (data: any) => void) {
  const tankRef = ref(database, `tanks/${tankId}`);
  onValue(tankRef, (snapshot) => {
    callback(snapshot.val());
  });
}

// Example: Write tank data
export function updateTankData(tankId: string, data: any) {
  const tankRef = ref(database, `tanks/${tankId}`);
  set(tankRef, data);
}
