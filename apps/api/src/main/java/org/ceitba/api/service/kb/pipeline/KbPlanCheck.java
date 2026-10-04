package org.ceitba.api.service.kb.pipeline;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.Collection;
import java.util.Map;
import java.util.TreeMap;

// What validating one PLAN answer kept and dropped (count per reason),
// shared by the pipeline and evals. Dropped operations are logged and
// recorded (kb_run.stats.droppedPlanOps / eval results) instead of
// vanishing; a plan whose operations were all dropped is asked once more.
public final class KbPlanCheck {

    public static final String NO_SOURCES = "noSources";            // create/update with an empty `sources`
    public static final String UNKNOWN_SOURCES = "unknownSources";  // only ids that are not inputs of the subject
    public static final String INVALID_SLUG = "invalidSlug";
    public static final String DUPLICATE_SLUG = "duplicateSlug";
    public static final String INVALID_OP = "invalidOp";            // not create/update/delete
    public static final String UNKNOWN_PAGE = "unknownPage";        // update/delete of a page that does not exist
    public static final String DELETE_IGNORED = "deleteIgnored";    // evals rebuild from scratch: no deletes

    public static final String EMPTY_PLAN_ERROR = "plan returned no operations with valid sources";
    public static final String INDEX_ONLY_ERROR = "plan_insufficient: a first compilation with several sources "
        + "planned only the index page (no topic or concept pages)";

    private final int proposed;
    private int kept;
    private final Map<String, Integer> dropped = new TreeMap<>();
    private int contentKept;         // kept create/update operations that are not the index
    private int firstCompileSources; // >= 2: a first compilation whose plan must have more than the index

    public KbPlanCheck(JsonNode proposed) {
        this.proposed = proposed == null ? 0 : proposed.size();
    }

    public void kept() {
        kept++;
    }

    // A kept create/update of the page `slug`.
    public void keptPage(String slug) {
        kept();
        if (!slug.equals("index")) contentKept++;
    }

    // The subject is compiled for the first time (no existing pages) from
    // `usableSources` files: with at least two, an index-only plan is not enough.
    public void firstCompile(int usableSources) {
        this.firstCompileSources = usableSources;
    }

    public boolean indexOnly() {
        return firstCompileSources >= 2 && kept > 0 && contentKept == 0;
    }

    // Nothing usable: all operations dropped, or (first compilation) only an index.
    public boolean insufficient() {
        return emptyAfterFiltering() || indexOnly();
    }

    // "indice"/"índice" of an index page is the slug "index".
    public static String normalizeIndexSlug(String slug, String type) {
        if (type == null || !type.trim().equalsIgnoreCase("index")) return slug;
        var folded = java.text.Normalizer.normalize(slug, java.text.Normalizer.Form.NFD)
            .replaceAll("\\p{M}+", "").toLowerCase(java.util.Locale.ROOT);
        return folded.equals("indice") ? "index" : slug;
    }

    public void dropped(String reason) {
        dropped.merge(reason, 1, Integer::sum);
    }

    // The reason a create/update has no usable source: none given, or
    // only ids that are not inputs of the subject.
    public void droppedForSources(JsonNode given) {
        dropped(given == null || given.isEmpty() ? NO_SOURCES : UNKNOWN_SOURCES);
    }

    public int proposed() {
        return proposed;
    }

    public int keptCount() {
        return kept;
    }

    public Map<String, Integer> droppedByReason() {
        return dropped;
    }

    public boolean anyDropped() {
        return !dropped.isEmpty();
    }

    // The model proposed operations but none survived validation.
    public boolean emptyAfterFiltering() {
        return proposed > 0 && kept == 0;
    }

    public ObjectNode toJson(ObjectMapper json) {
        var o = json.createObjectNode();
        o.put("proposed", proposed);
        o.put("kept", kept);
        var d = o.putObject("dropped");
        dropped.forEach(d::put);
        return o;
    }

    // The corrective note appended to a PLAN request whose operations were
    // all dropped.
    public static String correction(Collection<String> validIds) {
        return correction(validIds, false);
    }

    public static String correction(Collection<String> validIds, boolean indexOnly) {
        if (indexOnly) {
            return "## Corrección\n\nYour previous plan only created the `index` page. This subject has several "
                + "sources and no pages yet: plan the topic and concept pages too (one `create` per topic or concept "
                + "the sources teach, each with `sources` copied exactly from the valid ids), plus the index. Answer "
                + "again with `submit_plan`.\n\nValid ids: " + String.join(", ", validIds);
        }
        return "## Corrección\n\nIn your previous answer no operation could be used: every `create` and `update` "
            + "needs `sources` with at least one id copied exactly from this list of valid file ids (no names, no "
            + "invented ids). Answer again with `submit_plan`.\n\nValid ids: " + String.join(", ", validIds);
    }
}
