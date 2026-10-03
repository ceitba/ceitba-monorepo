package org.ceitba.api.service.drive;

import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class DriveCommunityServiceTest {

    @Test
    void folderNamesMapToTheFirstKnownSubjectCode() {
        var known = Set.of("11.77", "12.44", "71.88");
        assertThat(DriveCommunityService.codes("12.43 - 12.44 - Ciencia de Materiales")).containsExactly("12.43", "12.44");
        assertThat(DriveCommunityService.subjectFor("11.77 - Estadística Aplicada 1", known, Set.of())).contains("11.77");
        // The first code is not a subject: the next one is used.
        assertThat(DriveCommunityService.subjectFor("12.43 - 12.44 - Ciencia de Materiales", known, Set.of())).contains("12.44");
        // Organizational folders, unknown codes and names without a code are skipped.
        assertThat(DriveCommunityService.subjectFor("00.00 - Resúmenes", known, Set.of())).isEmpty();
        assertThat(DriveCommunityService.subjectFor("00.01 Útil", known, Set.of())).isEmpty();
        assertThat(DriveCommunityService.subjectFor("99.99 - Desconocida", known, Set.of())).isEmpty();
        assertThat(DriveCommunityService.subjectFor("Varios", known, Set.of())).isEmpty();
        // Dev allowlist.
        assertThat(DriveCommunityService.subjectFor("11.77 - Estadística Aplicada 1", known, Set.of("71.88"))).isEmpty();
    }
}
