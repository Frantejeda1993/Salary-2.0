package es.frantejeda.salary;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Lee una notificación de pago (Google Wallet u otra app elegida) y saca importe, comercio y
 * tarjeta. Java puro, sin Android, para poder probarlo. Si no está seguro, devuelve null: es
 * mejor no proponer nada que proponer un importe equivocado.
 */
public final class PaymentParser {

    /** Lo que se lleva al alta rápida de la app (#/nuevo?importe=…&comercio=…&wallet=…). */
    public static final class Payment {
        /** Importe tal cual lo escribe la notificación, sin espacios ni símbolo: «12,50», «1.234,56», «12.50». */
        public final String amount;
        public final String merchant;
        /** Nombre de la tarjeta en Wallet («Visa ••1234»): la app aprende a qué cuenta corresponde. */
        public final String card;

        Payment(String amount, String merchant, String card) {
            this.amount = amount;
            this.merchant = merchant;
            this.card = card;
        }

        @Override public String toString() { return amount + " | " + merchant + " | " + card; }
    }

    private static final String NUM = "(\\d{1,3}(?:[.\\u00a0\\u202f ]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
    /** «12,50 €», «12,50€», «12,50 EUR», «€12.50», «EUR 12,50», «-12,50 €». */
    private static final Pattern AMOUNT = Pattern.compile(
        "(?:(?:€|EUR)\\s?-?" + NUM + ")|(?:-?" + NUM + "\\s?(?:€|EUR)(?![A-Za-z]))");

    /** Avisos que no son un gasto tuyo: ingresos, devoluciones, saldo, recibos rechazados… */
    private static final Pattern NOT_EXPENSE = Pattern.compile(
        "(?i)\\b(recibid[oa]s?|has recibido|te han enviado|ingreso|abono|devoluci[oó]n|reembolso|reembolsad[oa]|"
        + "saldo|rechazad[oa]|denegad[oa]|cancelad[oa]|fallid[oa]|no se ha podido|received|refund|declined|balance)\\b");

    /** Títulos que no son un comercio. */
    private static final Pattern GENERIC_TITLE = Pattern.compile(
        "(?i)^(google wallet|google pay|wallet|samsung wallet|samsung pay|pago|pago realizado|compra|compra realizada|"
        + "pago con tarjeta|has pagado|payment|purchase|transacci[oó]n|nueva transacci[oó]n|movimiento|cargo)\\b.*");

    private static final Pattern MERCHANT_EN = Pattern.compile("(?i)\\b(?:en|at)\\s+(.+?)(?=\\s+(?:con|with|el|on|mediante)\\b|[.\\n·,]|$)");
    private static final Pattern CARD_CON = Pattern.compile("(?i)\\b(?:con|with)\\s+(?:la\\s+|tu\\s+|your\\s+)?(?:tarjeta\\s+|card\\s+)?(.+?)(?=[.\\n·]|$)");
    private static final Pattern CARD_DIGITS = Pattern.compile("((?:[A-Za-zÀ-ÿ]+\\s+)?(?:[•*·]+|[xX]{2,})\\s?\\d{4})\\b");
    private static final Pattern CARD_WORD = Pattern.compile("(?i)^(?:tarjeta|card|tu|la|your)\\s+");

    private PaymentParser() {}

    /**
     * @param title título de la notificación (en Wallet suele ser el comercio)
     * @param text  texto (en Wallet, el importe y la tarjeta)
     */
    public static Payment parse(String title, String text) {
        String t = clean(title);
        String x = clean(text);
        String all = (t + "\n" + x).trim();
        if (all.isEmpty() || NOT_EXPENSE.matcher(all).find()) return null;

        Matcher m = AMOUNT.matcher(all);
        if (!m.find()) return null;
        String amount = normalizeAmount(m.group(1) != null ? m.group(1) : m.group(2));
        // Dos importes distintos (p. ej. «Pagado 12 € · saldo 300 €»): no sabemos cuál es; mejor nada.
        String first = amount;
        while (m.find()) {
            String other = normalizeAmount(m.group(1) != null ? m.group(1) : m.group(2));
            if (!other.equals(first)) return null;
        }
        if (amount.isEmpty() || isZero(amount)) return null;

        String merchant = "";
        if (!t.isEmpty() && !AMOUNT.matcher(t).find() && !GENERIC_TITLE.matcher(t).matches()) merchant = t;
        if (merchant.isEmpty()) {
            Matcher me = MERCHANT_EN.matcher(all);
            while (me.find()) {
                String cand = me.group(1).trim();
                if (!AMOUNT.matcher(cand).find() && !cand.isEmpty()) { merchant = cand; break; }
            }
        }

        String card = "";
        Matcher cd = CARD_DIGITS.matcher(x.isEmpty() ? all : x);
        if (cd.find()) card = CARD_WORD.matcher(cd.group(1).trim()).replaceFirst("").trim();
        if (card.isEmpty()) {
            Matcher cc = CARD_CON.matcher(x);
            if (cc.find()) {
                String cand = cc.group(1).trim();
                if (!AMOUNT.matcher(cand).find()) card = cand;
            }
        }
        return new Payment(amount, trimTo(merchant, 60), trimTo(card, 40));
    }

    /** Hay algo que parece un importe en euros (para detectar apps de pago candidatas). */
    public static boolean looksLikeAmount(String title, String text) {
        return AMOUNT.matcher(clean(title) + "\n" + clean(text)).find();
    }

    static String normalizeAmount(String raw) {
        return raw.replace(" ", "").replace(" ", "").replace(" ", "");
    }

    private static boolean isZero(String a) {
        return a.replaceAll("[.,0]", "").isEmpty();
    }

    private static String clean(String s) {
        if (s == null) return "";
        return s.replace('\r', ' ').replaceAll("[\\t ]+", " ").trim();
    }

    private static String trimTo(String s, int n) {
        String v = s.replaceAll("\\s+", " ").trim();
        return v.length() > n ? v.substring(0, n).trim() : v;
    }

    /** Para los registros de diagnóstico: minúsculas sin acentos. */
    static String norm(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT);
    }
}
