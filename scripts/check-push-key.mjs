/**
 * Stops `npm run deploy:hosting` when the web push key is missing.
 *
 * Without VITE_FCM_VAPID_KEY the site still builds, but browsers cannot register
 * for push alerts and the bell shows "Push Unavailable". (The Android app is not
 * affected: it uses native push.)
 *
 * To deploy without browser push on purpose: set ALLOW_NO_PUSH_KEY=1.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const env = loadEnv('production', frontendDir, 'VITE_');

if (env.VITE_FCM_VAPID_KEY) {
  console.log('Web push key found.');
} else if (process.env.ALLOW_NO_PUSH_KEY === '1') {
  console.warn('WARNING: deploying without VITE_FCM_VAPID_KEY. Browsers will not get push alerts.');
} else {
  console.error(
    [
      '',
      'Deploy stopped: VITE_FCM_VAPID_KEY is not set, so browsers would lose push alerts.',
      '',
      '  1. Copy frontend/.env.example to frontend/.env',
      '  2. Firebase console > Project settings > Cloud Messaging > Web Push certificates',
      '     Copy the existing key pair (generate one only if none exists).',
      '  3. Put it after VITE_FCM_VAPID_KEY= and run the deploy again.',
      '',
      'To deploy without browser push anyway, set ALLOW_NO_PUSH_KEY=1.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
