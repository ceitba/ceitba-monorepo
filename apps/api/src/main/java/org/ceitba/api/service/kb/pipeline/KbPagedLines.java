package org.ceitba.api.service.kb.pipeline;

import org.ceitba.api.repository.kb.KbRunRequestRepository;
import org.ceitba.api.service.kb.llm.LlmLine;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Objects;

// The requests' canonical lines for a list of custom ids, `page` at a time
// (each page in its own transaction, so its entities are gone afterwards):
// only about one page of request params is in memory, however many ids there
// are. Used for batch files and the sync executor's feed.
final class KbPagedLines {

    private KbPagedLines() {}

    static Iterator<LlmLine> of(List<String> ids, int page, TransactionTemplate tx, KbRunRequestRepository requests) {
        int size = Math.max(1, page);
        return new Iterator<>() {
            int next = 0;
            Iterator<LlmLine> current = Collections.emptyIterator();

            @Override
            public boolean hasNext() {
                while (!current.hasNext() && next < ids.size()) {
                    var slice = ids.subList(next, Math.min(ids.size(), next + size));
                    next += slice.size();
                    var byId = tx.execute(s -> {
                        var m = new HashMap<String, LlmLine>();
                        requests.findAllById(slice).forEach(r -> m.put(r.getCustomId(),
                            new LlmLine(r.getCustomId(), r.getParams())));
                        return m;
                    });
                    current = slice.stream().map(byId::get).filter(Objects::nonNull).iterator();
                }
                return current.hasNext();
            }

            @Override
            public LlmLine next() {
                if (!hasNext()) throw new NoSuchElementException();
                return current.next();
            }
        };
    }
}
