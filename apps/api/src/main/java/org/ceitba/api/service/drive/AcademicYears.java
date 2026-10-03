package org.ceitba.api.service.drive;

import java.text.Normalizer;
import java.util.Locale;
import java.util.OptionalInt;
import java.util.Set;
import java.util.regex.Pattern;

// The academic year written in a file or folder name (best effort):
//   - a 4-digit year 2000..currentYear standing as its own token
//     ("Resumen Quimica ingreso 2020", "Parciales_2019", "TP-2021"), unless
//     it is a quantity ("Tabla 2000 filas");
//   - a 2-digit year after a term marker: 1C'21, 2C-22, 1c 21, cuatri-21,
//     cuatrimestre 2 '20.
// The last match wins ("Final 2019 (recuperatorio 2020)" -> 2020).
public final class AcademicYears {

    private static final Pattern FULL = Pattern.compile("(?<![0-9a-z])(20[0-9]{2})(?![0-9a-z])");
    private static final Pattern TERM = Pattern.compile(
        "(?<![0-9a-z])(?:[12]\\s*c|cuatri(?:mestre)?(?:\\s*[12])?)\\s*(?:'|-|\\s)\\s*'?([0-9]{2})(?![0-9a-z])");
    // Words that make the number a quantity, not a year.
    private static final Set<String> QUANTITIES = Set.of(
        "filas", "columnas", "datos", "registros", "pesos", "dolares", "usd", "ars", "palabras", "paginas",
        "hojas", "km", "kg", "mts", "metros", "unidades", "personas", "casos", "items", "lineas", "caracteres");
    private static final Pattern NEXT_WORD = Pattern.compile("^\\s+([a-z]+)");

    private AcademicYears() {}

    public static OptionalInt fromName(String name, int currentYear) {
        if (name == null || name.isBlank()) return OptionalInt.empty();
        var text = Normalizer.normalize(name, Normalizer.Form.NFD).replaceAll("\\p{M}+", "").toLowerCase(Locale.ROOT);
        int found = -1;
        int foundAt = -1;
        var m = FULL.matcher(text);
        while (m.find()) {
            int year = Integer.parseInt(m.group(1));
            if (year > currentYear) continue;
            var next = NEXT_WORD.matcher(text.substring(m.end()));
            if (next.find() && QUANTITIES.contains(next.group(1))) continue;
            if (m.start() >= foundAt) {
                found = year;
                foundAt = m.start();
            }
        }
        var t = TERM.matcher(text);
        while (t.find()) {
            int year = 2000 + Integer.parseInt(t.group(1));
            if (year > currentYear) continue;
            if (t.start() >= foundAt) {
                found = year;
                foundAt = t.start();
            }
        }
        return found < 0 ? OptionalInt.empty() : OptionalInt.of(found);
    }
}
