import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.watersystem.msu',
  appName: 'MSU Water System',
  webDir: '../frontend/dist',
  server: {
    url: 'https://msu-water-monitoring-system.web.app',
    cleartext: false,
  },
  plugins: {
    PushNotifications: {
      // Also show alerts as a banner (with sound and badge) while the app is open
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: "#ffffffff",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
