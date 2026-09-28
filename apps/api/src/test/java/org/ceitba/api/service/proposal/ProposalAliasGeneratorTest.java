package org.ceitba.api.service.proposal;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class ProposalAliasGeneratorTest {

    @Test
    void portedWordListGivesGreekLetterTimesColorCombos() {
        var combos = ProposalAliasGenerator.loadCombos();
        assertThat(combos).hasSize(24 * 20).doesNotHaveDuplicates()
            .contains("AlfaRojo", "ÉpsilonAzul", "OmegaIndigo");
        assertThat(combos).allSatisfy(c -> assertThat(c).hasSizeLessThanOrEqualTo(40).matches("\\p{Lu}\\p{Ll}+\\p{Lu}\\p{Ll}+"));
    }

    @Test
    void neverReturnsATakenAliasAndFallsBackToSuffixes() {
        var gen = new ProposalAliasGenerator(List.of("AlfaRojo", "BetaAzul"), new Random(42));
        Set<String> taken = new HashSet<>();
        for (int i = 0; i < 6; i++) {
            String next = gen.next(taken);
            assertThat(taken).doesNotContain(next);
            taken.add(next);
        }
        assertThat(taken).contains("AlfaRojo", "BetaAzul")
            .anyMatch(a -> a.matches("(AlfaRojo|BetaAzul)[2-9]"));
    }

    @Test
    void defaultGeneratorCoversEveryCombo() {
        var gen = new ProposalAliasGenerator();
        Set<String> taken = new HashSet<>();
        for (int i = 0; i < gen.size(); i++) taken.add(gen.next(taken));
        assertThat(taken).hasSize(gen.size()).allMatch(a -> !Character.isDigit(a.charAt(a.length() - 1)));
    }
}
