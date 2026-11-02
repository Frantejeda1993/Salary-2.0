package es.frantejeda.salary;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Lo que la app guarda en el móvil (nunca sale de él): de qué apps leer, apps candidatas y las
 * últimas notificaciones de pago vistas (para diagnosticar formatos que no entiende).
 */
final class Prefs {
    static final String WALLET = "com.google.android.apps.walletnfcrel";
    private static final String FILE = "avisos";
    private static final int MAX_SAMPLES = 15;

    private Prefs() {}

    private static SharedPreferences sp(Context c) { return c.getSharedPreferences(FILE, Context.MODE_PRIVATE); }

    /** Apps de las que se leen pagos. Por defecto, solo Google Wallet. */
    static Set<String> enabled(Context c) {
        Set<String> def = new HashSet<>();
        def.add(WALLET);
        return new HashSet<>(sp(c).getStringSet("enabled", def));
    }

    static void setEnabled(Context c, String pkg, boolean on) {
        Set<String> s = enabled(c);
        if (on) s.add(pkg); else s.remove(pkg);
        sp(c).edit().putStringSet("enabled", s).apply();
    }

    /** Apps que han mostrado algo parecido a un importe en euros (solo el nombre, no el texto). */
    static Map<String, String> candidates(Context c) {
        Map<String, String> out = new LinkedHashMap<>();
        try {
            JSONObject o = new JSONObject(sp(c).getString("candidates", "{}"));
            JSONArray names = o.names();
            if (names != null) for (int i = 0; i < names.length(); i++) out.put(names.getString(i), o.getString(names.getString(i)));
        } catch (JSONException ignored) { }
        return out;
    }

    static void addCandidate(Context c, String pkg, String label) {
        try {
            JSONObject o = new JSONObject(sp(c).getString("candidates", "{}"));
            if (o.has(pkg)) return;
            o.put(pkg, label);
            sp(c).edit().putString("candidates", o.toString()).apply();
        } catch (JSONException ignored) { }
    }

    /** Últimas notificaciones de las apps elegidas: si se entendieron y cómo. */
    static JSONArray samples(Context c) {
        try { return new JSONArray(sp(c).getString("samples", "[]")); } catch (JSONException e) { return new JSONArray(); }
    }

    static void addSample(Context c, String app, String title, String text, String result) {
        try {
            JSONArray old = samples(c);
            JSONArray out = new JSONArray();
            JSONObject s = new JSONObject();
            s.put("t", System.currentTimeMillis());
            s.put("app", app);
            s.put("title", title == null ? "" : title);
            s.put("text", text == null ? "" : text);
            s.put("result", result);
            out.put(s);
            for (int i = 0; i < old.length() && out.length() < MAX_SAMPLES; i++) out.put(old.get(i));
            sp(c).edit().putString("samples", out.toString()).apply();
        } catch (JSONException ignored) { }
    }

    static void clearSamples(Context c) { sp(c).edit().remove("samples").apply(); }

    /** Evita avisar dos veces del mismo pago (Wallet a veces actualiza la notificación). */
    static boolean seenRecently(Context c, String key) {
        long now = System.currentTimeMillis();
        long last = sp(c).getLong("seen:" + key, 0);
        sp(c).edit().putLong("seen:" + key, now).apply();
        return now - last < 10 * 60 * 1000;
    }
}
