package es.frantejeda.salary;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertFalse;

import org.junit.Test;

/** Formatos de notificación inventados a partir de los habituales; importes y comercios ficticios. */
public class PaymentParserTest {

    private static void expect(String title, String text, String amount, String merchant, String card) {
        PaymentParser.Payment p = PaymentParser.parse(title, text);
        assertNotNull(title + " / " + text, p);
        assertEquals(amount, p.amount);
        assertEquals(merchant, p.merchant);
        assertEquals(card, p.card);
    }

    @Test public void walletEspanol() {
        expect("Mercadona", "12,50 € con Visa ••1234", "12,50", "Mercadona", "Visa ••1234");
        expect("Panadería Sol", "3,20 €", "3,20", "Panadería Sol", "");
        expect("Repsol", "1.234,56 € · Mastercard •••• 9876", "1.234,56", "Repsol", "Mastercard •••• 9876");
    }

    @Test public void walletIngles() {
        expect("Cafe Uno", "€4.10 with Visa ••4321", "4.10", "Cafe Uno", "Visa ••4321");
    }

    @Test public void bancoConComercioEnElTexto() {
        expect("Compra con tarjeta", "Compra de 25,00 € en LIDL MADRID con tu tarjeta *1234", "25,00", "LIDL MADRID", "*1234");
        expect("Google Wallet", "Pagaste 7,99 EUR en Netflix", "7,99", "Netflix", "");
    }

    @Test public void noEsUnGasto() {
        assertNull(PaymentParser.parse("Bizum recibido", "Has recibido 20,00 € de Ana"));
        assertNull(PaymentParser.parse("Devolución", "Devolución de 15,00 € en Zara"));
        assertNull(PaymentParser.parse("Pago rechazado", "No se ha podido pagar 9,00 €"));
        assertNull(PaymentParser.parse("Mercadona", "Pagado 12,00 € · saldo 300,00 €"));
        assertNull(PaymentParser.parse("Mercadona", "Sin importe"));
        assertNull(PaymentParser.parse("Mercadona", "0,00 €"));
    }

    @Test public void detectaImportes() {
        assertTrue(PaymentParser.looksLikeAmount("x", "Pago de 3 €"));
        assertFalse(PaymentParser.looksLikeAmount("Hola", "Quedamos a las 3"));
    }
}
