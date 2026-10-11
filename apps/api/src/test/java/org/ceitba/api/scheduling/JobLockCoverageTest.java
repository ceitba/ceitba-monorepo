package org.ceitba.api.scheduling;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.AnnotatedBeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.core.type.classreading.MetadataReader;
import org.springframework.scheduling.annotation.Scheduled;

import java.util.Arrays;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

// Every @Scheduled method must run under JobLock (apps/api/docs/DEPLOY.md
// "Scheduled jobs"): during a blue/green deploy two API containers fire the
// same ticks. A new @Scheduled method fails this test until it gets a
// JobLock.Job (a new, never-reused id) and wraps its body in runExclusively,
// or is listed below with the reason it doesn't need one.
class JobLockCoverageTest {

    // Methods whose cross-process safety comes from elsewhere.
    private static final Set<String> EXEMPT = Set.of(
        "OrgMailJob#tick"   // hands off to the sender; its delivery claims (SKIP LOCKED) prevent double sends
    );

    @Test
    void everyScheduledMethodHasAJobLock() throws Exception {
        // Every class, whatever its @Conditional* (jobs that are off by default
        // count too), loaded without running static initializers.
        var scanner = new ClassPathScanningCandidateComponentProvider(false) {
            @Override
            protected boolean isCandidateComponent(MetadataReader reader) {
                return true;
            }

            @Override
            protected boolean isCandidateComponent(AnnotatedBeanDefinition definition) {
                return true;
            }
        };
        var scheduled = new TreeSet<String>();
        var loader = getClass().getClassLoader();
        for (var bean : scanner.findCandidateComponents("org.ceitba.api")) {
            var type = Class.forName(bean.getBeanClassName(), false, loader);
            for (var m : type.getDeclaredMethods()) {
                if (!AnnotatedElementUtils.getMergedRepeatableAnnotations(m, Scheduled.class).isEmpty()) {
                    scheduled.add(type.getSimpleName() + "#" + m.getName());
                }
            }
        }
        var covered = Arrays.stream(JobLock.Job.values()).map(JobLock.Job::method).collect(Collectors.toCollection(TreeSet::new));
        covered.addAll(EXEMPT);

        assertThat(scheduled).isNotEmpty().isEqualTo(covered);
    }

    @Test
    void jobIdsAreUnique() {
        var ids = Arrays.stream(JobLock.Job.values()).map(JobLock.Job::id).collect(Collectors.toSet());
        assertThat(ids).hasSize(JobLock.Job.values().length).doesNotContain(8); // 8: retired ORG_MAIL
    }
}
