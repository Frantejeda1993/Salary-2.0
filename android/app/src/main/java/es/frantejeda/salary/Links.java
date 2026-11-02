package es.frantejeda.salary;

import android.net.Uri;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Enlaces a la PWA. El alta rápida ya entiende estos parámetros (los usa el atajo de iPhone). */
final class Links {
    static final String APP = "https://frantejeda1993.github.io/Salary-2.0/";

    private Links() {}

    static String newExpense(PaymentParser.Payment p, long when) {
        StringBuilder q = new StringBuilder();
        add(q, "importe", p.amount);
        add(q, "comercio", p.merchant);
        add(q, "wallet", p.card);
        add(q, "fecha", new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date(when)));
        return APP + "#/nuevo?" + q;
    }

    private static void add(StringBuilder q, String k, String v) {
        if (v == null || v.isEmpty()) return;
        if (q.length() > 0) q.append('&');
        q.append(k).append('=').append(Uri.encode(v));
    }
}
