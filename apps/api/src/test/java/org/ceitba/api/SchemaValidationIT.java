package org.ceitba.api;

import org.ceitba.api.support.SharedPostgres;
import org.ceitba.api.repository.CareerRepository;
import org.ceitba.api.repository.CeitbaStaffRepository;
import org.ceitba.api.repository.CommissionRepository;
import org.ceitba.api.repository.PlanRepository;
import org.ceitba.api.repository.PlanSubjectRepository;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.UserRepository;
import org.ceitba.api.repository.wiki.CareerNoteRepository;
import org.ceitba.api.repository.wiki.CareerNoteVoteRepository;
import org.ceitba.api.repository.wiki.SubjectBookmarkRepository;
import org.ceitba.api.repository.wiki.SubjectCommentRepository;
import org.ceitba.api.repository.wiki.SubjectCommentVoteRepository;
import org.ceitba.api.repository.wiki.SubjectDifficultyRepository;
import org.ceitba.api.repository.wiki.SubjectNoteRepository;
import org.ceitba.api.repository.wiki.SubjectNoteVoteRepository;
import org.ceitba.api.repository.wiki.SubjectWikiEditProposalRepository;
import org.ceitba.api.repository.wiki.SubjectWikiPageRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

// Boots the full Spring app against a Testcontainers Postgres. Flyway runs
// V1__baseline.sql, then Hibernate validates every entity mapping against
// the schema. If any @Entity / @Column is wrong, this test fails on startup.
@SpringBootTest
class SchemaValidationIT {

    static final SharedPostgres.Database POSTGRES = SharedPostgres.newDatabase();

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired CareerRepository careerRepository;
    @Autowired PlanRepository planRepository;
    @Autowired UserRepository userRepository;
    @Autowired SubjectRepository subjectRepository;
    @Autowired CommissionRepository commissionRepository;
    @Autowired PlanSubjectRepository planSubjectRepository;
    @Autowired CeitbaStaffRepository ceitbaStaffRepository;

    @Autowired SubjectDifficultyRepository subjectDifficultyRepository;
    @Autowired SubjectCommentRepository subjectCommentRepository;
    @Autowired SubjectCommentVoteRepository subjectCommentVoteRepository;
    @Autowired SubjectNoteRepository subjectNoteRepository;
    @Autowired SubjectNoteVoteRepository subjectNoteVoteRepository;
    @Autowired CareerNoteRepository careerNoteRepository;
    @Autowired CareerNoteVoteRepository careerNoteVoteRepository;
    @Autowired SubjectWikiPageRepository subjectWikiPageRepository;
    @Autowired SubjectWikiEditProposalRepository subjectWikiEditProposalRepository;
    @Autowired SubjectBookmarkRepository subjectBookmarkRepository;
    @Autowired JdbcTemplate jdbc;

    @Test
    void everyRepositoryReachesAnEmptyTable() {
        assertThat(careerRepository.count()).isZero();
        assertThat(planRepository.count()).isZero();
        assertThat(userRepository.count()).isZero();
        assertThat(subjectRepository.count()).isZero();
        assertThat(commissionRepository.count()).isZero();
        assertThat(planSubjectRepository.count()).isZero();
        assertThat(ceitbaStaffRepository.count()).isZero();

        assertThat(subjectDifficultyRepository.count()).isZero();
        assertThat(subjectCommentRepository.count()).isZero();
        assertThat(subjectCommentVoteRepository.count()).isZero();
        assertThat(subjectNoteRepository.count()).isZero();
        assertThat(subjectNoteVoteRepository.count()).isZero();
        assertThat(careerNoteRepository.count()).isZero();
        assertThat(careerNoteVoteRepository.count()).isZero();
        assertThat(subjectWikiPageRepository.count()).isZero();
        assertThat(subjectWikiEditProposalRepository.count()).isZero();
        assertThat(subjectBookmarkRepository.count()).isZero();
    }

    @Test
    void userTableHasUniqueFileNumberAndNoSgaColumn() {
        // V28 / mirror V4.21 dropped the SGA prefill marker.
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'sga_synced_at'
                """, Integer.class)).isZero();
        // PATCH /v1/me/profile relies on this index to reject a taken file number.
        assertThat(jdbc.queryForObject("""
                SELECT indexdef FROM pg_indexes
                WHERE schemaname = 'public' AND indexname = 'user_file_number_key'
                """, String.class)).startsWith("CREATE UNIQUE INDEX");
    }
}
