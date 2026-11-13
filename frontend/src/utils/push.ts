/**
 * @file push.ts
 * @description Push notification registration for this device (R9 + Android native push).
 *
 * - In a browser: Firebase Cloud Messaging over Web Push, delivered through the
 *   service worker in /firebase-messaging-sw.js, so alerts arrive with the tab closed.
 * - In the Android app (Capacitor): native FCM through @capacitor/push-notifications,
 *   because Android WebView does not support the Web Push API.
 *
 * Either way the device token is stored under /userState/{uid}/fcmTokens/{token}.
 * The alert worker (backend/worker) reads those tokens and sends the pushes; a
 * browser cannot push to other users by itself.
 */
import { Capacitor } from '@capacitor/core';
import { ref, set, remove } from 'firebase/database';
import { app, database } from '@/config/firebase';

const TOKEN_STORAGE_KEY = 'wm_push_token';
const VAPID_KEY = import.meta.env.VITE_FCM_VAPID_KEY as string | undefined;

export type PushStatus =
  | 'enabled'         // this device is registered
  | 'available'       // can be enabled
  | 'blocked'         // the user or browser denied notifications
  | 'not-configured'  // web push key (VITE_FCM_VAPID_KEY) is missing from the build
  | 'unsupported';    // this browser cannot receive push

export interface PushResult {
  status: PushStatus;
  message?: string;
}

const isNative = () => Capacitor.isNativePlatform();

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

async function saveToken(uid: string, token: string, platform: 'web' | 'android' | 'ios') {
  const previous = storedToken();
  if (previous && previous !== token) {
    await remove(ref(database, `userState/${uid}/fcmTokens/${previous}`)).catch(() => {});
  }
  await set(ref(database, `userState/${uid}/fcmTokens/${token}`), { platform, updatedAt: Date.now() });
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Storage unavailable: the token is still registered server-side
  }
}

async function webSupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) {
    return false;
  }
  const { isSupported } = await import('firebase/messaging');
  return isSupported().catch(() => false);
}

/** Current push state of this device, without prompting the user. */
export async function getPushStatus(): Promise<PushStatus> {
  try {
    if (isNative()) {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const permission = await PushNotifications.checkPermissions();
      if (permission.receive === 'denied') return 'blocked';
      return permission.receive === 'granted' && storedToken() ? 'enabled' : 'available';
    }
    if (!(await webSupported())) return 'unsupported';
    if (!VAPID_KEY) return 'not-configured';
    if (Notification.permission === 'denied') return 'blocked';
    return Notification.permission === 'granted' && storedToken() ? 'enabled' : 'available';
  } catch {
    return 'unsupported';
  }
}

async function registerNative(uid: string): Promise<PushResult> {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  let permission = await PushNotifications.checkPermissions();
  if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
    permission = await PushNotifications.requestPermissions();
  }
  if (permission.receive !== 'granted') {
    return { status: 'blocked', message: 'Notifications are turned off for this app in Android settings.' };
  }

  const handles: { remove: () => Promise<void> }[] = [];
  const result = await new Promise<PushResult>((resolve) => {
    let settled = false;
    const finish = (value: PushResult) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    PushNotifications.addListener('registration', (token) => {
      saveToken(uid, token.value, Capacitor.getPlatform() === 'ios' ? 'ios' : 'android')
        .then(() => finish({ status: 'enabled' }))
        .catch(() => finish({ status: 'available', message: 'Could not save this device. Check your connection.' }));
    }).then((h) => handles.push(h));
    PushNotifications.addListener('registrationError', (error) => {
      // Usually means google-services.json was missing when the APK was built
      finish({ status: 'unsupported', message: `Push registration failed: ${error.error}` });
    }).then((h) => handles.push(h));
    PushNotifications.register().catch((err) => finish({ status: 'unsupported', message: String(err?.message ?? err) }));
    setTimeout(() => finish({ status: 'available', message: 'Push registration timed out. Try again.' }), 15000);
  });
  // These listeners are per attempt: drop them so repeated refreshes do not pile up
  handles.forEach((h) => h.remove().catch(() => {}));
  return result;
}

async function registerWeb(uid: string): Promise<PushResult> {
  if (!(await webSupported())) {
    return { status: 'unsupported', message: 'This browser cannot receive push notifications.' };
  }
  if (!VAPID_KEY) {
    return { status: 'not-configured', message: 'Push is not set up for this site yet (missing web push key).' };
  }
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') {
    return { status: 'blocked', message: 'Notifications are blocked for this site in your browser settings.' };
  }

  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const { getMessaging, getToken } = await import('firebase/messaging');
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) return { status: 'available', message: 'Could not get a push token. Try again.' };

  await saveToken(uid, token, 'web');
  return { status: 'enabled' };
}

/** Asks for permission if needed and registers this device for push alerts. */
export async function enablePush(uid: string): Promise<PushResult> {
  try {
    return isNative() ? await registerNative(uid) : await registerWeb(uid);
  } catch (err: unknown) {
    console.error('Push registration failed:', err);
    return { status: 'available', message: err instanceof Error ? err.message : 'Push registration failed.' };
  }
}

/**
 * Refreshes this device's token when push was already enabled (tokens rotate).
 * Never prompts: it only runs when permission has already been granted.
 */
export async function refreshPushRegistration(uid: string): Promise<void> {
  try {
    if (!storedToken()) return;
    if ((await getPushStatus()) === 'enabled') await enablePush(uid);
  } catch {
    // Best effort
  }
}

/** Stops push on this device. Called from the bell menu and on sign-out. */
export async function disablePush(uid: string): Promise<void> {
  const token = storedToken();
  try {
    if (token) await remove(ref(database, `userState/${uid}/fcmTokens/${token}`));
  } catch (err) {
    console.warn('Could not remove push token:', err);
  }
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    if (isNative()) {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      await PushNotifications.unregister();
    } else if (token && (await webSupported())) {
      const { getMessaging, deleteToken } = await import('firebase/messaging');
      await deleteToken(getMessaging(app));
    }
  } catch {
    // The server-side token is already gone, which is what stops delivery
  }
}

const OPT_OUT_KEY = 'wm_push_opted_out';

/** Remembers that the user turned push off themselves, so it is not switched back on. */
export function setPushOptOut(optedOut: boolean): void {
  try {
    if (optedOut) localStorage.setItem(OPT_OUT_KEY, '1');
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    // Storage unavailable
  }
}

/**
 * Android app only: turns push alerts on automatically after sign-in, so workers
 * do not have to find the Enable Push button. Android shows its permission prompt
 * the first time; after that it is silent. Skipped if the user turned push off in
 * the bell menu or blocked notifications in Android settings.
 */
export async function autoEnableNativePush(uid: string): Promise<PushResult | null> {
  if (!isNative()) return null;
  try {
    if (localStorage.getItem(OPT_OUT_KEY)) return null;
    if ((await getPushStatus()) !== 'available') return null;
  } catch {
    return null;
  }
  return enablePush(uid);
}

let tapListenerAdded = false;

/**
 * Android app only: tapping a push alert (banner or notification shade) opens
 * the Notifications page. Safe to call more than once.
 */
export async function listenForPushTaps(open: (path: string) => void): Promise<void> {
  if (!isNative() || tapListenerAdded) return;
  tapListenerAdded = true;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.addListener('pushNotificationActionPerformed', () => open('/notifications'));
  } catch {
    tapListenerAdded = false;
  }
}

/**
 * Android app only: once everything is read, clears this app's alerts from the
 * notification shade, which also clears the badge on the app icon.
 */
export async function clearDeliveredPushNotifications(): Promise<void> {
  if (!isNative()) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.removeAllDeliveredNotifications();
  } catch {
    // Best effort
  }
}
