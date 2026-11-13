import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";
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

export const app = initializeApp(firebaseConfig);

/**
 * Firebase App Check: proves requests come from this web app, not a script that copied
 * the public config. It is switched on by providing a reCAPTCHA v3 site key at build
 * time (VITE_RECAPTCHA_SITE_KEY); without the key the app runs exactly as before.
 *
 * Enforcement is chosen per product in the Firebase console. Do NOT enforce it for
 * Realtime Database: the ESP32 writes over REST and cannot send App Check tokens,
 * so enforcement there would block the controller.
 */
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;
if (typeof window !== 'undefined' && recaptchaSiteKey) {
  try {
    if (import.meta.env.DEV) {
      // Local development: use a debug token instead of solving reCAPTCHA on localhost
      (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
        import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn('App Check could not be initialised:', err);
  }
}
export const database = getDatabase(app);
export const auth = getAuth(app);
export const firestore = getFirestore(app);

export let analytics: Analytics | null = null;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {
    // Analytics unsupported in this environment
  });
}
