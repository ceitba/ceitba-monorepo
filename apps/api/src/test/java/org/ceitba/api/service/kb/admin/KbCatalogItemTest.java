package org.ceitba.api.service.kb.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

// DO's public catalog (recorded fixture): per-token prices despite the field names.
class KbCatalogItemTest {

    Map<String, KbCatalogItem> items() throws Exception {
        var root = new ObjectMapper().readTree(getClass().getResourceAsStream("/kb/do-model-catalog.json"));
        Map<String, KbCatalogItem> out = new HashMap<>();
        root.path("data").forEach(n -> {
            var i = KbCatalogItem.of(n);
            out.put(i.id(), i);
        });
        return out;
    }

    @Test
    void perTokenPricesAreConvertedToPerMillion() throws Exception {
        var glm = items().get("glm-5.3");
        assertThat(glm.inputPerM()).isEqualByComparingTo("1.40");
        assertThat(glm.outputPerM()).isEqualByComparingTo("4.40");
        assertThat(glm.cacheReadPerM()).isEqualByComparingTo("0.26");
        assertThat(glm.perTokenFields()).containsExactly("input", "output", "cacheRead");
        var flash = items().get("glm-5.3-flash");
        assertThat(flash.inputPerM()).isEqualByComparingTo("0.15");
        assertThat(flash.outputPerM()).isEqualByComparingTo("0.50");
        assertThat(flash.cacheReadPerM()).isEqualByComparingTo("0.03");   // from input_cache_read
        assertThat(flash.creator()).isEqualTo("zhipu");
        assertThat(items().get("deepseek-4-flash").cacheReadPerM()).isEqualByComparingTo("0.028");
        assertThat(items().get("openai-gpt-oss-120b").outputPerM()).isEqualByComparingTo("0.70");
    }

    @Test
    void valuesAlreadyPerMillionAreKept() throws Exception {
        var haiku = items().get("anthropic-claude-haiku-4.5");
        assertThat(haiku.inputPerM()).isEqualByComparingTo("1");
        assertThat(haiku.outputPerM()).isEqualByComparingTo("5");
        assertThat(haiku.cacheReadPerM()).isEqualByComparingTo("0.10");
        assertThat(haiku.perTokenFields()).isEmpty();
    }

    @Test
    void numbersAsStringsAndFilters() throws Exception {
        var glm = items().get("glm-5.3");
        assertThat(glm.contextWindow()).isEqualTo(200000);
        assertThat(glm.maxOutputTokens()).isEqualTo(128000);
        assertThat(glm.has("reasoning")).isTrue();
        assertThat(items().get("anthropic-claude-haiku-4.5").has("tool_calling")).isFalse();   // unreliable
        assertThat(items().get("dedicated-only-x").serverlessChat()).isFalse();
        assertThat(items().get("some-embedding").serverlessChat()).isFalse();
        assertThat(items().get("kimi-k2.6").serverlessChat()).isTrue();
        assertThat(items().get("kimi-k2.6").cacheReadPerM()).isNull();
        // Long creators are cut to the provider column (32).
        var node = new ObjectMapper().readTree("{\"model_id\":\"m\",\"creator\":\"UKP Lab (Technical University of Darmstadt)\"}");
        assertThat(KbCatalogItem.of(node).creator()).hasSize(32);
    }
}
