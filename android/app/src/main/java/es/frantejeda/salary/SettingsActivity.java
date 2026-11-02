package es.frantejeda.salary;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.format.DateFormat;
import android.util.TypedValue;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Date;
import java.util.Map;
import java.util.Set;

/**
 * «Avisos de pago»: permisos, de qué apps leer y las últimas notificaciones vistas. Se abre desde
 * Ajustes de Salary (Android), manteniendo pulsado el icono o desde Ajustes del sistema.
 */
public class SettingsActivity extends Activity {
    private LinearLayout root;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setTitle(R.string.settings_title);
        ScrollView scroll = new ScrollView(this);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        root.setPadding(pad, pad, pad, pad);
        scroll.addView(root);
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        render();
    }

    private void render() {
        root.removeAllViews();
        boolean access = hasListenerAccess();
        text(getString(R.string.intro), 15, false);

        section(getString(R.string.step_access));
        text(access ? getString(R.string.access_on) : getString(R.string.access_off), 15, true);
        button(access ? getString(R.string.access_change) : getString(R.string.access_grant), v ->
            startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        if (!access && Build.VERSION.SDK_INT >= 33) {
            // Apps instaladas fuera de Google Play: Android bloquea este permiso hasta desbloquearlo a mano.
            text(getString(R.string.restricted_help), 13, false);
            button(getString(R.string.restricted_button), v -> startActivity(
                new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))));
        }

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            section(getString(R.string.step_post));
            button(getString(R.string.post_grant), v -> requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1));
        }

        section(getString(R.string.step_apps));
        Set<String> enabled = Prefs.enabled(this);
        toggle("Google Wallet", Prefs.WALLET, enabled.contains(Prefs.WALLET));
        Map<String, String> cands = Prefs.candidates(this);
        for (Map.Entry<String, String> e : cands.entrySet()) {
            if (!e.getKey().equals(Prefs.WALLET)) toggle(e.getValue(), e.getKey(), enabled.contains(e.getKey()));
        }
        for (String pkg : enabled) {
            if (!pkg.equals(Prefs.WALLET) && !cands.containsKey(pkg)) toggle(pkg, pkg, true);
        }
        text(getString(R.string.apps_help), 13, false);

        section(getString(R.string.step_test));
        button(getString(R.string.test_button), v -> {
            PaymentListener.notifyPayment(this, PaymentParser.parse("Prueba", "1,00 € con Prueba ••0000"), System.currentTimeMillis());
            Toast.makeText(this, R.string.test_sent, Toast.LENGTH_SHORT).show();
        });
        button(getString(R.string.open_app), v -> startActivity(new Intent(this, LauncherActivity.class)));

        section(getString(R.string.step_battery));
        text(getString(R.string.battery_help), 13, false);
        button(getString(R.string.battery_button), v -> {
            try { startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); }
            catch (RuntimeException e) { startActivity(new Intent(Settings.ACTION_SETTINGS)); }
        });

        section(getString(R.string.step_samples));
        JSONArray samples = Prefs.samples(this);
        if (samples.length() == 0) text(getString(R.string.samples_empty), 13, false);
        StringBuilder all = new StringBuilder();
        for (int i = 0; i < samples.length(); i++) {
            JSONObject s = samples.optJSONObject(i);
            if (s == null) continue;
            String line = DateFormat.format("dd/MM HH:mm", new Date(s.optLong("t"))) + " · " + s.optString("app")
                + "\n«" + s.optString("title") + "» «" + s.optString("text") + "»\n→ " + s.optString("result");
            text(line, 13, false);
            all.append(line).append("\n\n");
        }
        if (samples.length() > 0) {
            button(getString(R.string.samples_copy), v -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Salary", all.toString()));
                Toast.makeText(this, R.string.copied, Toast.LENGTH_SHORT).show();
            });
            button(getString(R.string.samples_clear), v -> { Prefs.clearSamples(this); render(); });
        }
        text(getString(R.string.privacy), 12, false);
        text("Versión " + version(), 12, false);
    }

    private boolean hasListenerAccess() {
        String flat = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        ComponentName me = new ComponentName(this, PaymentListener.class);
        return flat != null && flat.contains(me.flattenToString());
    }

    private String version() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (PackageManager.NameNotFoundException e) { return "?"; }
    }

    // ----------------------------------------------------------------- piezas de interfaz

    private void section(String title) {
        TextView t = text(title, 18, true);
        t.setPadding(0, dp(22), 0, dp(6));
    }

    private TextView text(String s, int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(4), 0, dp(4));
        t.setTextIsSelectable(true);
        root.addView(t);
        return t;
    }

    private void button(String label, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setMinHeight(dp(48));
        b.setOnClickListener(l);
        root.addView(b, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
    }

    private void toggle(String label, String pkg, boolean on) {
        Switch s = new Switch(this);
        s.setText(label);
        s.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        s.setMinHeight(dp(48));
        s.setChecked(on);
        s.setOnCheckedChangeListener((b, checked) -> Prefs.setEnabled(this, pkg, checked));
        root.addView(s);
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    /** Abrir esta pantalla desde la PWA: salary://avisos (ver AndroidManifest). */
    static Uri deepLink() { return Uri.parse("salary://avisos"); }
}
