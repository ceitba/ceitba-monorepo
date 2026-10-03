package org.ceitba.api.service.kb.llm;

import org.ceitba.api.domain.kb.KbModel;

import java.math.BigDecimal;
import java.math.RoundingMode;

// Cost of one request from recorded token usage and a catalog price
// (docs/SUBJECT-WIKI-ADMIN.md §2-3): uncached input at input_per_m, cached
// input at cache_read_per_m (input price when unknown), output at
// output_per_m, all per million tokens; BATCH mode takes batch_discount off
// ("up to 50%": an estimate). Unknown model or price -> 0.
public final class KbPricing {

    private static final BigDecimal MILLION = BigDecimal.valueOf(1_000_000);

    private KbPricing() {}

    // Per-million prices actually paid in a mode (ADMIN doc §7):
    // list x (1 - batchDiscount) in BATCH, list otherwise; cached input at
    // cacheReadPerM (discounted too when batched).
    public record Prices(BigDecimal inputPerM, BigDecimal outputPerM, BigDecimal cacheReadPerM) {}

    public static Prices effective(KbModel model, String mode) {
        if (model == null) return null;
        var factor = "BATCH".equals(mode) && model.getBatchDiscount() != null
            ? BigDecimal.ONE.subtract(model.getBatchDiscount()) : BigDecimal.ONE;
        return new Prices(scale(model.getInputPerM(), factor), scale(model.getOutputPerM(), factor),
            scale(model.getCacheReadPerM(), factor));
    }

    private static BigDecimal scale(BigDecimal price, BigDecimal factor) {
        return price == null ? null : price.multiply(factor).setScale(4, RoundingMode.HALF_UP).stripTrailingZeros();
    }

    public static BigDecimal cost(KbModel model, String mode, long input, long cached, long output) {
        if (model == null || model.getInputPerM() == null || model.getOutputPerM() == null) return BigDecimal.ZERO;
        long c = Math.max(0, Math.min(cached, input));
        long uncached = input - c;
        var cacheRate = model.getCacheReadPerM() != null ? model.getCacheReadPerM() : model.getInputPerM();
        var total = model.getInputPerM().multiply(BigDecimal.valueOf(uncached))
            .add(cacheRate.multiply(BigDecimal.valueOf(c)))
            .add(model.getOutputPerM().multiply(BigDecimal.valueOf(output)));
        if ("BATCH".equals(mode) && model.getBatchDiscount() != null) {
            total = total.multiply(BigDecimal.ONE.subtract(model.getBatchDiscount()));
        }
        return total.divide(MILLION, 6, RoundingMode.HALF_UP);
    }
}
