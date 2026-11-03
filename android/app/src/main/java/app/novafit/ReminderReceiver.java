package app.novafit;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Показывает уведомление, когда срабатывает будильник. */
public class ReminderReceiver extends BroadcastReceiver {
    static final String CH_REMIND = "reminders";
    static final String CH_TIMER = "timer";

    @Override
    public void onReceive(Context ctx, Intent i) {
        show(ctx, i.getIntExtra("id", 1), i.getStringExtra("title"), i.getStringExtra("body"), i.getStringExtra("channel"));
    }

    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel r = new NotificationChannel(CH_REMIND, "Напоминания", NotificationManager.IMPORTANCE_HIGH);
        r.setDescription("Еда, тренировка, сон, взвешивание и замеры");
        r.enableVibration(true);
        NotificationChannel t = new NotificationChannel(CH_TIMER, "Таймер отдыха", NotificationManager.IMPORTANCE_HIGH);
        t.setDescription("Сигнал об окончании отдыха между подходами");
        t.enableVibration(true);
        t.setVibrationPattern(new long[]{0, 300, 150, 300, 150, 500});
        nm.createNotificationChannel(r);
        nm.createNotificationChannel(t);
    }

    @SuppressWarnings("deprecation")
    static void show(Context ctx, int id, String title, String body, String channel) {
        ensureChannels(ctx);
        if (channel == null || channel.isEmpty()) channel = CH_REMIND;
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, channel) : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setColor(0xFF1E6B57)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setCategory(CH_TIMER.equals(channel) ? Notification.CATEGORY_ALARM : Notification.CATEGORY_REMINDER);
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        }
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        try { nm.notify(CH_TIMER.equals(channel) ? Bridge.TIMER_ID : id, b.build()); } catch (SecurityException ignored) { }
    }
}
