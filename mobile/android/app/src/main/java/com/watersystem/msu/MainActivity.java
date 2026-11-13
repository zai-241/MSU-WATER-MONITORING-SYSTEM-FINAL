package com.watersystem.msu;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        createAlertChannel();

        final long startTime = System.currentTimeMillis();
        // Keep the splash screen visible for 2 seconds
        splashScreen.setKeepOnScreenCondition(() -> System.currentTimeMillis() - startTime < 2000);

        // Set up fade-out and scale-down animation for the splash screen
        splashScreen.setOnExitAnimationListener(splashScreenViewProvider -> {
            final android.view.View splashScreenView = splashScreenViewProvider.getView();
            final android.view.View iconView = splashScreenViewProvider.getIconView();

            // Create fade-out animation
            android.view.ViewPropertyAnimator fadeOut = splashScreenView.animate()
                    .alpha(0f)
                    .setDuration(500L)
                    .setInterpolator(new android.view.animation.AccelerateInterpolator())
                    .withEndAction(splashScreenViewProvider::remove);

            // Create scale-down animation for the icon
            iconView.animate()
                    .scaleX(0f)
                    .scaleY(0f)
                    .setDuration(500L)
                    .setInterpolator(new android.view.animation.AccelerateInterpolator())
                    .start();

            fadeOut.start();
        });
    }

    /**
     * Push alerts use this channel. High importance makes Android show them as a
     * heads-up banner (not only a status-bar icon), with sound and vibration, and
     * showBadge puts the unread dot/count on the app icon. Created at every launch
     * (a no-op once it exists) so it is ready before the first push arrives.
     * Android lets the user change these later in the app's notification settings.
     */
    private void createAlertChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel channel = new NotificationChannel(
                getString(R.string.alert_channel_id),
                getString(R.string.alert_channel_name),
                NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(getString(R.string.alert_channel_description));
        channel.setShowBadge(true);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 400, 200, 400 });
        channel.enableLights(true);
        channel.setLightColor(getResources().getColor(R.color.colorPrimary, getTheme()));
        channel.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
        manager.createNotificationChannel(channel);
    }
}
