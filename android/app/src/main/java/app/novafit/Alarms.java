package app.novafit;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/** Будильники для напоминаний. Точные, если система разрешает, иначе — «примерные». */
final class Alarms {
    private Alarms() { }

    static void scheduleAll(Context ctx, String json) {
        try {
            JSONArray arr = new JSONArray(json);
            long now = System.currentTimeMillis();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                long at = o.getLong("at");
                if (at <= now) continue;
                set(ctx, o.getInt("id"), at, o.optString("title"), o.optString("body"), ReminderReceiver.CH_REMIND);
            }
        } catch (Exception ignored) { }
    }

    static void cancelAll(Context ctx, String json) {
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) cancel(ctx, arr.getJSONObject(i).getInt("id"));
        } catch (Exception ignored) { }
    }

    static PendingIntent pi(Context ctx, int id, String title, String body, String channel) {
        Intent i = new Intent(ctx, ReminderReceiver.class)
                .putExtra("id", id).putExtra("title", title).putExtra("body", body).putExtra("channel", channel);
        return PendingIntent.getBroadcast(ctx, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void set(Context ctx, int id, long at, String title, String body, String channel) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent p = pi(ctx, id, title, body, channel);
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        try {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p);
        }
    }

    static void cancel(Context ctx, int id) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        am.cancel(pi(ctx, id, "", "", ""));
    }
}
