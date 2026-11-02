# Fase 8c — Gastos compartidos: diseño para aprobar

Estado: **programado** (2-nov-2026), pendiente de aprobación. Nombres e importes inventados.
Decisiones: E3–E6 y su implementación E7–E12 en `DECISIONES.md`. Diferencia con este diseño:
el pago al saldar sale siempre de la cuenta principal (E8).

## 1. Idea en una frase

Cada uno sigue llevando **su dinero en su app**; la pareja comparte solo una lista de gastos
compartidos con su reparto, y los pagos entre ellos. De ahí sale un **saldo** («Eva te debe
42,10 €») que se arrastra mes a mes hasta que se salda.

## 2. Dónde vive cada cosa

| Qué | Dónde | Lo ven |
| --- | --- | --- |
| El gasto real (salida de dinero, cuenta o tarjeta) | En los movimientos de **quien pagó**, como hoy, marcado como compartido | Solo quien pagó |
| El gasto compartido: fecha, concepto, importe, quién pagó, reparto | `pairs/{id}/shared/{gasto}` | Los dos |
| La categoría de cada uno para su parte | En el gasto compartido, una por persona (cada uno elige la suya) | Los dos |
| Pagos entre vosotros (saldar) | `pairs/{id}/settlements/{pago}` + un movimiento en la cuenta de cada uno al confirmarse | Los dos |
| Ingresos del mes de cada uno (para el reparto por ingresos) | `pairs/{id}/incomes/{persona_mes}`: **solo el total**, lo escribe la app de cada uno | Los dos |

## 3. Cómo afecta a las cifras de cada uno (ejemplo)

Ana paga **100 €** en el súper con su cuenta, a medias con Eva (50/50).

| | Ana (pagó) | Eva (no pagó) |
| --- | --- | --- |
| Saldo real de la cuenta | −100 € (salió el dinero) | 0 € (no salió nada) |
| Budget y categoría «Comida» | +50 € (su parte) | +50 € (su parte, en la categoría que elija Eva) |
| Cierre previsto del mes | −100 € (el dinero ya salió) | −50 € (lo que debe, aunque aún no haya pagado) |
| «Si se saldan…» | −50 € (cuenta que Eva le devuelve 50) | −50 € (ya lo tenía descontado) |
| Gastos compartidos en Mes | «Eva te debe 50,00 €» | «Debes 50,00 € a Ana» |

**Eva paga 30 € en noviembre** (Bizum, transferencia…) y Ana lo confirma:

| | Ana | Eva |
| --- | --- | --- |
| Saldo real | +30 € (−70 € en total) | −30 € |
| Cierre previsto | −70 € | −50 € (no cambia: los 30 € ya estaban contados como deuda) |
| Saldo compartido | Eva te debe 20 € | Debes 20 € a Ana |

**En diciembre** se arrastran los 20 €: la sección empieza con «Pendiente de noviembre: 20 €». En
el cierre previsto de Eva de diciembre siguen descontados hasta que los pague.

### Reparto por ingresos

En noviembre Ana cobra 2.000 € y Eva 1.000 € → Ana 66,67 %, Eva 33,33 %. En el gasto de 100 €:
Ana 66,67 € y Eva 33,33 €. Si a Eva le entra un ingreso de 500 € el día 20, el reparto de **todos**
los gastos por ingresos de noviembre pasa a 57,14 % / 42,86 % y la sección lo avisa: «Repartido
según los ingresos de noviembre: puede cambiar hasta el cierre del mes». Si alguien corrige un
ingreso de noviembre en diciembre, el reparto de noviembre se recalcula (E5/7) y la app avisa de
que cambió un mes cerrado.

Céntimos: la parte de cada uno se redondea al céntimo y la diferencia de redondeo va a quien
pagó, para que las dos partes sumen exactamente el importe.

## 4. Pantallas

- **Alta rápida** (si compartes gastos): interruptor «Compartido con Eva». Al activarlo:
  ¿quién pagó? (yo / Eva), reparto (50/50, otro porcentaje, por ingresos del mes) y tu categoría.
  Vista previa: «Tu parte 66,67 € · Eva 33,33 €».
- **Mes → «Gastos compartidos»** (desplegable con el saldo como total): pendiente del mes
  anterior, gastos del mes con la parte de cada uno y cómo se repartió, pagos, y saldo final.
  Botón **Saldar** (todo o una parte).
- **Saldar**: quien paga elige desde qué cuenta e importe; queda «pendiente de confirmar» hasta
  que el otro confirma y elige en qué cuenta lo recibió. Solo al confirmar se crean los
  movimientos en las cuentas de cada uno (E6).
- **Gasto apuntado por el otro como «lo pagaste tú»**: te aparece en «Por hacer»: «Eva apuntó
  que pagaste 40 € en Ikea: ¿desde qué cuenta?», para que tu saldo real lo recoja.
- **Editar o borrar**: solo quien lo creó (E6); el otro ve «Modificado por Ana» en el gasto.
- **Dejar de compartir**: bloqueado si el saldo no es 0 (E6).

## 5. Lo que cambia en el motor

Entra un dato nuevo, «líneas compartidas» por mes, calculado fuera del motor a partir de la
lista de la pareja. Con él:
- Budgets y gasto por categoría cuentan **solo tu parte** de cada gasto compartido.
- El cierre previsto de quien no pagó resta lo que debe (como la deuda de tarjeta sin saldar).
- «Si se saldan los préstamos» pasa a «…préstamos y gastos compartidos».
- Sin gastos compartidos, **ninguna cifra cambia** (se comprueba con los 12 sintéticos y tests).

## 6. Riesgos

- **Ingresos del otro desactualizados**: si Eva no abre la app en semanas, su total del mes no se
  actualiza y el reparto por ingresos queda provisional. Se muestra la fecha del último dato.
- **Dos apps escribiendo lo mismo**: la lista compartida la escriben los dos; se evita el
  conflicto con «solo quien lo creó lo edita».
- **Sin conexión**: un gasto compartido creado sin red aparece al otro cuando vuelva la señal.
