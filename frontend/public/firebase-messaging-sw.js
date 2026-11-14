/**
 * Firebase Cloud Messaging service worker.
 *
 * Runs in the background, separate from the page, so push alerts arrive even when
 * no MSU Water tab is open. The alert worker sends messages with a "notification"
 * payload, which the Firebase SDK displays automatically; tapping one opens the
 * link the worker attached (the notification history page).
 *
 * The version below must match the "firebase" package version in package.json.
 * The config values are the public web config (same as src/config/firebase.ts).
 */
importScripts('https://www.gstatic.com/firebasejs/12.9.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.9.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyB6p_Po6Al_sQshWOY01tbbq-eFgw4Z0TM',
  authDomain: 'msu-water-monitoring-system.firebaseapp.com',
  projectId: 'msu-water-monitoring-system',
  storageBucket: 'msu-water-monitoring-system.firebasestorage.app',
  messagingSenderId: '423241204607',
  appId: '1:423241204607:web:1ab3ffd28c42608222504a',
});

// Initialising messaging is what registers the push and notification-click handlers
firebase.messaging();

// Take over as soon as a new version is deployed
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
