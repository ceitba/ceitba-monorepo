package org.ceitba.api.service.sync;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.web.sync.dto.FirestoreImportResponse;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

// DataSyncController returns FirestoreImportResponse, not the service-side
// FirestoreImportReport; the JSON shape clients (and FirestoreImportIT) read
// must stay the same. Lives in this package to build a report directly.
class FirestoreImportResponseTest {

    @Test
    void mapsEveryCounterAndIssueAndKeepsTheJsonShape() throws Exception {
        var report = new FirestoreImportReport(true);
        report.getUsuarios().count(FirestoreImportReport.Outcome.CREATED);
        report.getUsuarios().count(FirestoreImportReport.Outcome.CREATED);
        report.getBenefits().count(FirestoreImportReport.Outcome.UPDATED);
        report.getPropuestas().count(FirestoreImportReport.Outcome.SKIPPED);
        report.getPropuestas().errors++;
        report.error(FirestoreImportService.PROPUESTAS, "prop-1", "missing title");
        report.warning(FirestoreImportService.USUARIOS, "uid-1", "invalid discord handle dropped");

        var response = FirestoreImportResponse.from(report);

        assertThat(response.dryRun()).isTrue();
        assertThat(response.created()).isEqualTo(2);
        assertThat(response.updated()).isEqualTo(1);
        assertThat(response.skipped()).isEqualTo(1);
        assertThat(response.usuarios()).isEqualTo(new FirestoreImportResponse.Counters(2, 0, 0, 0));
        assertThat(response.benefits()).isEqualTo(new FirestoreImportResponse.Counters(0, 1, 0, 0));
        assertThat(response.propuestas()).isEqualTo(new FirestoreImportResponse.Counters(0, 0, 1, 1));
        assertThat(response.errors()).containsExactly(
            new FirestoreImportResponse.Issue("propuestas", "prop-1", "missing title"));
        assertThat(response.warnings()).containsExactly(
            new FirestoreImportResponse.Issue("usuarios", "uid-1", "invalid discord handle dropped"));

        var json = new ObjectMapper().readTree(new ObjectMapper().writeValueAsString(response));
        assertThat(json.get("dryRun").asBoolean()).isTrue();
        assertThat(json.get("created").asLong()).isEqualTo(2);
        assertThat(json.get("usuarios").get("created").asLong()).isEqualTo(2);
        assertThat(json.get("propuestas").get("errors").asLong()).isEqualTo(1);
        assertThat(json.get("errors").get(0).get("collection").asText()).isEqualTo("propuestas");
        assertThat(json.get("warnings").get(0).get("id").asText()).isEqualTo("uid-1");
    }
}
