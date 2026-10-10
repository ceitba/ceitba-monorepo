package org.ceitba.api.external.llm;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;

// Deterministic in-memory embeddings (kb.embeddings.use-fake=true): a hashed
// bag of words, so texts sharing words are close under cosine distance and
// kNN behaves sensibly in tests and local demos without a model.
public class FakeEmbeddingClient implements EmbeddingClient {

    private final int dimensions;
    private final AtomicInteger calls = new AtomicInteger();

    public FakeEmbeddingClient(int dimensions) {
        this.dimensions = dimensions;
    }

    @Override
    public boolean available() {
        return true;
    }

    @Override
    public List<float[]> embed(String model, List<String> inputs) {
        calls.incrementAndGet();
        var out = new ArrayList<float[]>(inputs.size());
        for (var input : inputs) out.add(vector(input));
        return out;
    }

    // Requests served so far.
    public int calls() {
        return calls.get();
    }

    private float[] vector(String text) {
        var v = new float[dimensions];
        var folded = java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFD)
            .replaceAll("\\p{M}+", "").toLowerCase(Locale.ROOT);
        for (var word : folded.split("[^a-z0-9]+")) {
            if (word.length() < 3) continue;
            int h = java.util.Arrays.hashCode(word.getBytes(StandardCharsets.UTF_8));
            v[Math.floorMod(h, dimensions)] += 1f;
        }
        // An input with no words still needs a non-zero vector (cosine of zero is undefined).
        if (allZero(v)) v[0] = 1f;
        return v;
    }

    private static boolean allZero(float[] v) {
        for (float x : v) if (x != 0f) return false;
        return true;
    }
}
