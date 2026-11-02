package app.novafit;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** После перезагрузки телефона будильники сбрасываются — ставим их заново. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent i) {
        String json = ctx.getSharedPreferences(Bridge.PREFS, Context.MODE_PRIVATE).getString("schedule", "[]");
        Alarms.scheduleAll(ctx, json);
    }
}
