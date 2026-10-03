package org.ceitba.api.service.drive;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class AcademicYearsTest {

    static final int NOW = 2026;

    static Integer year(String name) {
        var y = AcademicYears.fromName(name, NOW);
        return y.isPresent() ? y.getAsInt() : null;
    }

    @Test
    void fourDigitYearsAsTheirOwnToken() {
        assertThat(year("Resumen Quimica ingreso 2020")).isEqualTo(2020);
        assertThat(year("Parciales 2019")).isEqualTo(2019);
        assertThat(year("TP-2021_final.pdf")).isEqualTo(2021);
        assertThat(year("2018 - Apuntes")).isEqualTo(2018);
        assertThat(year("Final 2019 (recuperatorio 2020)")).isEqualTo(2020);
        assertThat(year("Apuntes de Física")).isNull();
    }

    @Test
    void termMarkersWithTwoDigitYears() {
        assertThat(year("Parcial 1C'21")).isEqualTo(2021);
        assertThat(year("Final 2C-22")).isEqualTo(2022);
        assertThat(year("cuatri-20 resumen")).isEqualTo(2020);
        assertThat(year("Cuatrimestre 2 '19")).isEqualTo(2019);
    }

    @Test
    void negatives() {
        assertThat(year("Tabla 2000 filas")).isNull();
        assertThat(year("12020 casos")).isNull();
        assertThat(year("Ejercicio 2050")).isNull();         // future
        assertThat(year("v2021b")).isNull();                  // not its own token
        assertThat(year("Apuntes comunicacion 5/5/20")).isNull();
        assertThat(year("TP 21")).isNull();                  // 2 digits without a term marker
        assertThat(year("1999 resumen")).isNull();
    }
}
