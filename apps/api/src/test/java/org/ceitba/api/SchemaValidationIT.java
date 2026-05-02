package org.ceitba.api;

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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;

// Boots the full Spring app against a Testcontainers Postgres. Flyway runs
// V1__baseline.sql, then Hibernate validates every entity mapping against
// the schema. If any @Entity / @Column is wrong, this test fails on startup.
@SpringBootTest
@Testcontainers
class SchemaValidationIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

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
}
