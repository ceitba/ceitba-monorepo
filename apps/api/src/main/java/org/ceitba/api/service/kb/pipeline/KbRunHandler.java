package org.ceitba.api.service.kb.pipeline;

import org.ceitba.api.domain.kb.KbRun;

import java.util.UUID;

// What a kind of run does at each stage; KbRunEngine does the rest
// (requests, executors, polling, usage, cost limit). Implemented by the
// pipeline (KbPipelineService) and evaluations (KbEvalService).
//
//   DETECT -> DIGEST -> PLAN -> WRITE -> RETRY -> <final stage> -> DONE
//
// detect/build/after run inside the engine's transaction; complete manages
// its own transactions.
public interface KbRunHandler {

    boolean handles(KbRun run);

    // First stage: decide the work (and set the next stage).
    void detect(KbRun run);

    // Creates the stage's requests (KbRunEngine.request), returns how many.
    int build(KbRun run, String stage, KbRunEngine.Seq seq);

    // Uses the stage's results and sets the next stage.
    void after(KbRun run, String stage);

    // Once the stage's first attempt is answered, before after(): the
    // answered requests to send once more (already reset with redo(params)),
    // as custom ids. Used for a PLAN whose operations were all dropped.
    default java.util.List<String> redo(KbRun run, String stage) {
        return java.util.List.of();
    }

    // The final, non-LLM stage (PUBLISH for the pipeline, REPORT for evals).
    void complete(UUID runId);

    // kb_llm_usage.stage for a request of `stage` (evals record EVAL).
    default String usageStage(String stage) {
        return stage;
    }

    // Whether the weekly cost limit applies to this run.
    default boolean costLimited() {
        return true;
    }
}
