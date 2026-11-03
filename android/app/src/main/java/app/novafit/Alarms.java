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
                long at = localTime(o);
                if (at <= now) continue;
                set(ctx, o.getInt("id"), at, o.optString("title"), o.optString("body"), ReminderReceiver.CH_REMIND);
            }
        } catch (Exception ignored) { }
    }

    /**
     * Момент срабатывания: если есть местные дата и время («2026-11-03», «13:10»),
     * считаем их в ТЕКУЩЕМ часовом поясе телефона — после перелёта напоминание
     * про обед придёт в обед по местному времени. Иначе — сохранённый момент.
     */
    static long localTime(JSONObject o) {
        String date = o.optString("date", ""), time = o.optString("time", "");
        if (date.length() == 10 && time.length() == 5) {
            try {
                java.util.Calendar c = java.util.Calendar.getInstance();
                c.clear();
                c.set(Integer.parseInt(date.substring(0, 4)), Integer.parseInt(date.substring(5, 7)) - 1, Integer.parseInt(date.substring(8, 10)),
                        Integer.parseInt(time.substring(0, 2)), Integer.parseInt(time.substring(3, 5)), 0);
                return c.getTimeInMillis();
            } catch (Exception ignored) { }
        }
        return o.optLong("at", 0);
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
