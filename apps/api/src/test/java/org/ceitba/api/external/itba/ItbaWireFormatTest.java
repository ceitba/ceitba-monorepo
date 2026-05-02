package org.ceitba.api.external.itba;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import org.ceitba.api.external.itba.wire.CareerPlansResponse;
import org.ceitba.api.external.itba.wire.CourseCommissionsResponse;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

// The ITBA backend serializes lists as either an object (count==1) or an array
// (count>1). ACCEPT_SINGLE_VALUE_AS_ARRAY is what makes both shapes deserialize
// into List<>. Verifies it for every collection field on the wire types.
class ItbaWireFormatTest {

    private static ObjectMapper mapper;

    @BeforeAll
    static void setup() {
        mapper = JsonMapper.builder()
            .configure(DeserializationFeature.ACCEPT_SINGLE_VALUE_AS_ARRAY, true)
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
            .build();
    }

    @Test
    void careerPlans_singleSection_singleTerm_singleEntry_singleDependency_allDeserialize() throws Exception {
        // Worst-case shape: every list is a single object, not an array.
        var json = """
            {
              "careerplan": {
                "name": "Sistemas",
                "career": "S",
                "degreeLevel": "UNDERGRAD",
                "since": "2023",
                "section": {
                  "name": "Ciclo Básico",
                  "terms": {
                    "term": {
                      "year": "1",
                      "period": "1",
                      "entries": {
                        "entry": {
                          "type": "subject",
                          "name": "Algoritmos",
                          "code": "93.12",
                          "credits": "6",
                          "dependencies": { "dependency": "93.11" }
                        }
                      }
                    }
                  }
                }
              }
            }
            """;

        var resp = mapper.readValue(json, CareerPlansResponse.class);
        assertThat(resp.careerPlan().section()).hasSize(1);
        var section = resp.careerPlan().section().get(0);
        assertThat(section.terms().term()).hasSize(1);
        var term = section.terms().term().get(0);
        assertThat(term.entries().entry()).hasSize(1);
        var entry = term.entries().entry().get(0);
        assertThat(entry.code()).isEqualTo("93.12");
        assertThat(entry.dependencies().dependency()).containsExactly("93.11");
    }

    @Test
    void careerPlans_arrayShapes_alsoDeserialize() throws Exception {
        // Same content but every collection is a real array.
        var json = """
            {
              "careerplan": {
                "name": "Sistemas",
                "career": "S",
                "degreeLevel": "UNDERGRAD",
                "since": "2023",
                "section": [
                  {
                    "name": "Ciclo Básico",
                    "terms": {
                      "term": [
                        {
                          "year": "1",
                          "period": "1",
                          "entries": {
                            "entry": [
                              {
                                "type": "subject",
                                "name": "Algoritmos",
                                "code": "93.12",
                                "credits": "6",
                                "dependencies": { "dependency": ["93.11", "93.10"] }
                              },
                              {
                                "type": "subject",
                                "name": "Algoritmos II",
                                "code": "93.13",
                                "credits": "6"
                              }
                            ]
                          }
                        }
                      ]
                    }
                  }
                ]
              }
            }
            """;

        var resp = mapper.readValue(json, CareerPlansResponse.class);
        var section = resp.careerPlan().section().get(0);
        var entries = section.terms().term().get(0).entries().entry();
        assertThat(entries).hasSize(2);
        assertThat(entries.get(0).dependencies().dependency()).containsExactly("93.11", "93.10");
        assertThat(entries.get(1).dependencies()).isNull();
    }

    @Test
    void careerPlans_withoutTermBranch_singleEntry() throws Exception {
        // Electives are returned via withoutTerm.withoutTerm rather than terms.term.entries.entry.
        var json = """
            {
              "careerplan": {
                "name": "Sistemas",
                "career": "S",
                "degreeLevel": "UNDERGRAD",
                "since": "2023",
                "section": {
                  "name": "Electivas",
                  "withoutTerm": {
                    "withoutTerm": {
                      "type": "subject",
                      "name": "Tópicos Avanzados",
                      "code": "93.99",
                      "credits": "4",
                      "creditsRequired": "120"
                    }
                  }
                }
              }
            }
            """;

        var resp = mapper.readValue(json, CareerPlansResponse.class);
        var section = resp.careerPlan().section().get(0);
        assertThat(section.terms()).isNull();
        assertThat(section.withoutTerm().entries()).hasSize(1);
        var entry = section.withoutTerm().entries().get(0);
        assertThat(entry.code()).isEqualTo("93.99");
        assertThat(entry.creditsRequired()).isEqualTo("120");
    }

    @Test
    void courseCommissions_singleCommission_singleTimeSlot() throws Exception {
        var json = """
            {
              "courseCommissions": {
                "courseCommission": {
                  "subjectCode": "93.12",
                  "subjectName": "Algoritmos",
                  "subjectType": "SEMESTRAL",
                  "courseStart": "21/07/25",
                  "courseEnd": "31/12/25",
                  "commissionName": "A",
                  "commissionId": "93.12-A",
                  "quota": "30",
                  "enrolledStudents": "10",
                  "courseCommissionTimes": {
                    "day": "MONDAY",
                    "classRoom": "102T",
                    "building": "SDT",
                    "hourFrom": "14:00",
                    "hourTo": "17:00"
                  }
                }
              }
            }
            """;

        var resp = mapper.readValue(json, CourseCommissionsResponse.class);
        assertThat(resp.courseCommissions().courseCommission()).hasSize(1);
        var c = resp.courseCommissions().courseCommission().get(0);
        assertThat(c.commissionId()).isEqualTo("93.12-A");
        assertThat(c.courseCommissionTimes()).hasSize(1);
        assertThat(c.courseCommissionTimes().get(0).day()).isEqualTo("MONDAY");
    }

    @Test
    void courseCommissions_unknownExtraFieldsIgnored() throws Exception {
        // Wire model has @JsonIgnoreProperties(ignoreUnknown=true); upstream
        // adding new fields must not break us.
        var json = """
            {
              "courseCommissions": {
                "courseCommission": {
                  "subjectCode": "93.12",
                  "subjectName": "Algoritmos",
                  "subjectType": "SEMESTRAL",
                  "courseStart": "21/07/25",
                  "courseEnd": "31/12/25",
                  "commissionName": "A",
                  "commissionId": "93.12-A",
                  "quota": "30",
                  "enrolledStudents": "10",
                  "futureField": "value",
                  "courseCommissionTimes": []
                }
              }
            }
            """;

        var resp = mapper.readValue(json, CourseCommissionsResponse.class);
        assertThat(resp.courseCommissions().courseCommission()).hasSize(1);
    }
}
