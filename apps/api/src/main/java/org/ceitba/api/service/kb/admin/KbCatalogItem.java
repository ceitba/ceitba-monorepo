package org.ceitba.api.service.kb.admin;

import com.fasterxml.jackson.databind.JsonNode;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

// One item of DO's public model catalog, normalized. Prices: the catalog's
// *_price_per_million fields hold per-TOKEN prices (glm-5.3 input 1.4e-06);
// a value below 0.01 is taken as per token and multiplied by 1e6, otherwise
// as already per million (perTokenFields says which fields were converted).
public record KbCatalogItem(String id, String name, String creator, Integer contextWindow, Integer maxOutputTokens,
                            List<String> capabilities, List<String> availability, String type,
                            BigDecimal inputPerM, BigDecimal outputPerM, BigDecimal cacheReadPerM,
                            List<String> perTokenFields) {

    public static KbCatalogItem of(JsonNode n) {
        var pricing = n.path("pricing");
        var converted = new ArrayList<String>();
        var input = perMillion(pricing.path("input_price_per_million"), "input", converted);
        var output = perMillion(pricing.path("output_price_per_million"), "output", converted);
        var cacheNode = pricing.has("cache_read_input_price_per_million")
            ? pricing.path("cache_read_input_price_per_million") : pricing.path("input_cache_read");
        var cache = perMillion(cacheNode, "cacheRead", converted);
        var creator = n.path("creator");
        String creatorName = creator.isTextual() ? creator.asText()
            : creator.path("name").asText(creator.path("id").asText(null));
        return new KbCatalogItem(n.path("model_id").asText(n.path("id").asText(null)), n.path("name").asText(null),
            creatorName, integer(n.path("context_window")), integer(n.path("max_output_tokens")), strings(n.path("capabilities")),
            strings(n.path("availability")), n.path("type").asText(null), input, output, cache, List.copyOf(converted));
    }

    public boolean has(String capability) {
        return capabilities.stream().anyMatch(c -> c.equalsIgnoreCase(capability));
    }

    // Chat models served serverless (when the catalog says so).
    public boolean serverlessChat() {
        boolean chat = type == null || type.equalsIgnoreCase("chat");
        boolean serverless = availability.isEmpty() || availability.stream().anyMatch(a -> a.equalsIgnoreCase("serverless"));
        return chat && serverless;
    }

    static BigDecimal perMillion(JsonNode v, String field, List<String> converted) {
        if (v == null || v.isMissingNode() || v.isNull()) return null;
        BigDecimal d;
        try {
            d = v.isNumber() ? v.decimalValue() : new BigDecimal(v.asText().trim());
        } catch (NumberFormatException e) {
            return null;
        }
        if (d.signum() < 0) return null;
        if (d.signum() > 0 && d.compareTo(new BigDecimal("0.01")) < 0) {
            converted.add(field);
            d = d.multiply(BigDecimal.valueOf(1_000_000));
        }
        return d.setScale(4, RoundingMode.HALF_UP);
    }

    static Integer integer(JsonNode v) {
        if (v == null || v.isMissingNode() || v.isNull()) return null;
        if (v.canConvertToInt()) return v.asInt();
        try {
            return Integer.valueOf(v.asText().trim().replace(",", ""));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    static List<String> strings(JsonNode arr) {
        var out = new ArrayList<String>();
        if (arr != null && arr.isArray()) {
            arr.forEach(x -> out.add((x.isTextual() ? x.asText() : x.path("name").asText(x.toString()))
                .toLowerCase(Locale.ROOT)));
        }
        return out;
    }
}
