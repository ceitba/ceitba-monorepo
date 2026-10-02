package org.ceitba.api.domain.news;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class NewsCategoriesTest {

    @Test
    void patternAndMessageListExactlyTheCanonicalValues() {
        assertThat(NewsCategories.PATTERN).isEqualTo(String.join("|", NewsCategories.ALL));
        assertThat(NewsCategories.MESSAGE).isEqualTo("must be one of " + String.join(", ", NewsCategories.ALL));
    }

    @Test
    void patternIsCaseSensitive() {
        assertThat("Académico".matches(NewsCategories.PATTERN)).isTrue();
        assertThat("ACADÉMICO".matches(NewsCategories.PATTERN)).isFalse();
        assertThat("academico".matches(NewsCategories.PATTERN)).isFalse();
    }
}
