package org.ceitba.api.service.kb.llm;

import org.ceitba.api.domain.kb.KbModel;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

// Effective prices and request cost (ADMIN doc §2, §7).
class KbPricingTest {

    static KbModel model(String id, String in, String out, String cache, String discount) {
        var m = new KbModel(id, id, "x", KbChatPayloads.batchByRule(id), true);
        m.setPrices(new BigDecimal(in), new BigDecimal(out), cache == null ? null : new BigDecimal(cache),
            discount == null ? null : new BigDecimal(discount), null);
        return m;
    }

    @Test
    void syncPaysListPrice() {
        var haiku = model("anthropic-claude-haiku-4.5", "1.00", "5.00", "0.10", "0.5");
        // 1M uncached in + 1M out = 1 + 5
        assertThat(KbPricing.cost(haiku, "SYNC", 1_000_000, 0, 1_000_000)).isEqualByComparingTo("6");
        var p = KbPricing.effective(haiku, "SYNC");
        assertThat(p.inputPerM()).isEqualByComparingTo("1");
        assertThat(p.outputPerM()).isEqualByComparingTo("5");
    }

    @Test
    void batchTakesTheDiscountOffEverythingIncludingCachedInput() {
        var haiku = model("anthropic-claude-haiku-4.5", "1.00", "5.00", "0.10", "0.5");
        assertThat(KbPricing.cost(haiku, "BATCH", 1_000_000, 0, 1_000_000)).isEqualByComparingTo("3");
        var p = KbPricing.effective(haiku, "BATCH");
        assertThat(p.inputPerM()).isEqualByComparingTo("0.5");
        assertThat(p.outputPerM()).isEqualByComparingTo("2.5");
        assertThat(p.cacheReadPerM()).isEqualByComparingTo("0.05");
        // A different discount is honoured.
        var other = model("anthropic-claude-sonnet-5.5", "2.00", "10.00", "0.20", "0.3");
        assertThat(KbPricing.cost(other, "BATCH", 1_000_000, 0, 0)).isEqualByComparingTo("1.4");
    }

    @Test
    void cachedInputIsBilledAtCacheReadPrice() {
        var glm = model("glm-5.3", "1.40", "4.40", "0.26", "0.5");
        // 1M input of which 600k cached: 0.4 * 1.40 + 0.6 * 0.26 = 0.716
        assertThat(KbPricing.cost(glm, "SYNC", 1_000_000, 600_000, 0)).isEqualByComparingTo("0.716");
        // Cached tokens beyond the input are clamped.
        assertThat(KbPricing.cost(glm, "SYNC", 100, 1000, 0))
            .isEqualByComparingTo(KbPricing.cost(glm, "SYNC", 100, 100, 0));
        // Without a cache price, cached input pays the input price.
        var noCache = model("openai-gpt-oss-120b", "0.10", "0.70", null, "0.5");
        assertThat(KbPricing.cost(noCache, "SYNC", 1_000_000, 500_000, 0)).isEqualByComparingTo("0.1");
    }

    @Test
    void unknownModelCostsNothingAndBatchRule() {
        assertThat(KbPricing.cost(null, "SYNC", 1000, 0, 1000)).isEqualByComparingTo("0");
        assertThat(KbPricing.effective(null, "SYNC")).isNull();
        assertThat(KbChatPayloads.batchByRule("anthropic-claude-haiku-4.5")).isTrue();
        assertThat(KbChatPayloads.batchByRule("openai-gpt-5")).isTrue();
        assertThat(KbChatPayloads.batchByRule("openai-gpt-oss-120b")).isFalse();
        for (var m : new String[]{"glm-5.3", "deepseek-4-flash", "qwen3.8-max", "kimi-k2.6", "llama3.3-70b"}) {
            assertThat(KbChatPayloads.batchByRule(m)).as(m).isFalse();
        }
    }
}
