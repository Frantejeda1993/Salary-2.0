package es.frantejeda.salary;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

import java.util.Set;

/**
 * Lee las notificaciones de las apps elegidas (por defecto Google Wallet). Cuando una es un pago,
 * avisa «12,50 € en Mercadona: toca para apuntarlo»; al tocar se abre el alta rápida de Salary
 * rellena. No guarda nada por su cuenta: el gasto se guarda solo si lo confirmas en la app.
 */
public class PaymentListener extends NotificationListenerService {
    static final String CHANNEL = "pagos";

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            handle(sbn);
        } catch (RuntimeException ignored) {
            // Una notificación rara nunca debe tumbar el servicio.
        }
    }

    private void handle(StatusBarNotification sbn) {
        String pkg = sbn.getPackageName();
        if (pkg == null || pkg.equals(getPackageName())) return;
        Notification n = sbn.getNotification();
        if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        Bundle ex = n.extras;
        if (ex == null) return;
        String title = str(ex.getCharSequence(Notification.EXTRA_TITLE));
        CharSequence big = ex.getCharSequence(Notification.EXTRA_BIG_TEXT);
        String text = str(big != null ? big : ex.getCharSequence(Notification.EXTRA_TEXT));

        Set<String> enabled = Prefs.enabled(this);
        if (!enabled.contains(pkg)) {
            // Solo se recuerda el nombre de la app, nunca el texto: para ofrecerla en «Otras apps».
            if (!isMessaging(n) && PaymentParser.looksLikeAmount(title, text)) Prefs.addCandidate(this, pkg, label(pkg));
            return;
        }

        PaymentParser.Payment p = PaymentParser.parse(title, text);
        Prefs.addSample(this, label(pkg), title, text, p == null ? "No entendido" : p.toString());
        if (p == null) return;
        if (Prefs.seenRecently(this, pkg + "|" + p.amount + "|" + p.merchant)) return;
        notifyPayment(this, p, sbn.getPostTime());
    }

    /** Aviso propio que abre el alta rápida rellena. También lo usa «Probar» en la pantalla de avisos. */
    static void notifyPayment(Context c, PaymentParser.Payment p, long when) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        ensureChannel(c, nm);
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(Links.newExpense(p, when)), c, LauncherActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        int id = (int) (when ^ (when >>> 32)) ^ p.amount.hashCode();
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(c, id, open, flags);
        String what = p.amount + " €" + (p.merchant.isEmpty() ? "" : " en " + p.merchant);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_stat_salary)
            .setContentTitle(what)
            .setContentText(c.getString(R.string.tap_to_add))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_REMINDER);
        nm.notify(id, b.build());
    }

    static void ensureChannel(Context c, NotificationManager nm) {
        if (Build.VERSION.SDK_INT < 26 || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, c.getString(R.string.channel_name), NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(c.getString(R.string.channel_desc));
        nm.createNotificationChannel(ch);
    }

    private static boolean isMessaging(Notification n) {
        return Notification.CATEGORY_MESSAGE.equals(n.category) || Notification.CATEGORY_EMAIL.equals(n.category)
            || Notification.CATEGORY_SOCIAL.equals(n.category);
    }

    private String label(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            return String.valueOf(pm.getApplicationLabel(ai));
        } catch (PackageManager.NameNotFoundException e) {
            return Prefs.WALLET.equals(pkg) ? "Google Wallet" : pkg;
        }
    }

    private static String str(CharSequence cs) { return cs == null ? "" : cs.toString(); }
}
