package app.novafit;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** Мост JS → Android. Доступен на странице как window.NovaAndroid. */
public class Bridge {
    static final String PREFS = "novafit";
    static final int TIMER_ID = 900000;

    private final MainActivity act;
    private final Context ctx;

    Bridge(MainActivity a) { act = a; ctx = a.getApplicationContext(); }

    @JavascriptInterface
    public String version() { return "1"; }

    /** granted | denied | default */
    @JavascriptInterface
    public String notifState() {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 33) {
            if (ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
                return nm.areNotificationsEnabled() ? "granted" : "denied";
            boolean asked = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("askedNotif", false);
            return asked ? "denied" : "default";
        }
        return nm.areNotificationsEnabled() ? "granted" : "denied";
    }

    @JavascriptInterface
    public void requestNotifications() { act.runOnUiThread(act::requestNotificationPermission); }

    /** Можно ли ставить точные будильники (иначе напоминание может прийти на несколько минут позже). */
    @JavascriptInterface
    public boolean exactAlarms() {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        return am.canScheduleExactAlarms();
    }

    @JavascriptInterface
    public void openAlarmSettings() {
        if (Build.VERSION.SDK_INT < 31) return;
        try {
            Intent i = new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + ctx.getPackageName()));
            act.startActivity(i);
        } catch (Exception ignored) { }
    }

    /**
     * Запланировать напоминания. json — массив {id, at (мс), title, body}.
     * Прошлые напоминания отменяются, список запоминается для перезагрузки.
     */
    @JavascriptInterface
    public void schedule(String json) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Alarms.cancelAll(ctx, p.getString("schedule", "[]"));
        p.edit().putString("schedule", json).apply();
        Alarms.scheduleAll(ctx, json);
    }

    /** Будильник таймера отдыха — сработает, даже если приложение свёрнуто. */
    @JavascriptInterface
    public void timer(double atMs, String title, String body) {
        Alarms.set(ctx, TIMER_ID, (long) atMs, title, body, ReminderReceiver.CH_TIMER);
    }

    @JavascriptInterface
    public void cancelTimer() {
        Alarms.cancel(ctx, TIMER_ID);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(TIMER_ID);
    }

    @JavascriptInterface
    public void notifyNow(String title, String body) {
        ReminderReceiver.show(ctx, (int) (System.currentTimeMillis() % 100000), title, body, ReminderReceiver.CH_REMIND);
    }

    @JavascriptInterface
    public void keepAwake(boolean on) { act.runOnUiThread(() -> act.setKeepAwake(on)); }

    @JavascriptInterface
    public void vibrate(String csv) {
        try {
            String[] parts = csv.split(",");
            long[] pattern = new long[parts.length + 1];
            for (int i = 0; i < parts.length; i++) pattern[i + 1] = Long.parseLong(parts[i].trim());
            Vibrator v = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null) return;
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(pattern, -1));
            else v.vibrate(pattern, -1);
        } catch (Exception ignored) { }
    }

    @JavascriptInterface
    public boolean copy(String text) {
        try {
            ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("NovaFit", text));
            return true;
        } catch (Exception e) { return false; }
    }

    /** Открыть .ics в календаре (или поделиться, если календарь не умеет открывать файлы). */
    @JavascriptInterface
    public boolean openCalendar(String ics) {
        try {
            File f = new File(ctx.getCacheDir(), "novafit.ics");
            try (FileOutputStream out = new FileOutputStream(f)) { out.write(ics.getBytes(StandardCharsets.UTF_8)); }
            Uri uri = FileProvider.getUriForFile(ctx, "app.novafit.files", f);
            Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "text/calendar")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (view.resolveActivity(ctx.getPackageManager()) != null) {
                act.startActivity(view);
            } else {
                Intent send = new Intent(Intent.ACTION_SEND).setType("text/calendar")
                        .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                act.startActivity(Intent.createChooser(send, "Открыть в календаре"));
            }
            return true;
        } catch (Exception e) { return false; }
    }
}
