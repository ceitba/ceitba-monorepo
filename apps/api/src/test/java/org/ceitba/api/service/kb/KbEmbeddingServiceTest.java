package org.ceitba.api.service.kb;

import org.ceitba.api.config.KbEmbeddingProperties;
import org.ceitba.api.domain.kb.KbPage;
import org.ceitba.api.domain.kb.KbPageType;
import org.ceitba.api.external.llm.EmbeddingClient;
import org.ceitba.api.external.llm.EmbeddingUnreachableException;
import org.ceitba.api.external.llm.LlmApiException;
import org.ceitba.api.repository.kb.KbPageChunkRepository;
import org.ceitba.api.repository.kb.KbPageRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// The sweep's error handling: a page-level failure skips that page; a
// configuration error (auth, unknown model, wrong vector length) ends the sweep
// at once instead of failing every page.
class KbEmbeddingServiceTest {

    final KbPageRepository pages = mock(KbPageRepository.class);
    final KbPageChunkRepository chunks = mock(KbPageChunkRepository.class);
    final EmbeddingClient client = mock(EmbeddingClient.class);
    final KbEmbeddingProperties props =
        new KbEmbeddingProperties("http://embeddings/v1", null, null, null, null, false, null, null);
    final UUID a = UUID.randomUUID();
    final UUID b = UUID.randomUUID();
    KbEmbeddingService service;

    @BeforeEach
    void setUp() {
        service = new KbEmbeddingService(pages, chunks, client, props, mock(PlatformTransactionManager.class));
        when(client.available()).thenReturn(true);
        when(chunks.findPageIdsToEmbed(anyString(), anyInt())).thenReturn(List.of(a, b));
        when(pages.findById(any())).thenAnswer(inv -> Optional.of(page()));
    }

    static KbPage page() {
        var p = new KbPage("61.12", "van");
        p.setContent(KbPageType.CONCEPT, "VAN", "Resumen.", List.of(), "## Uno\nTexto.\n", List.of(), "test",
            OffsetDateTime.now());
        return p;
    }

    @Test
    void anUnreachableServerStopsTheSweepAfterOneRequest() {
        when(client.embed(anyString(), anyList())).thenThrow(new EmbeddingUnreachableException("embeddings -> 0: refused"));

        assertThat(service.embedPending().failed()).isEqualTo(1);
        verify(client, times(1)).embed(anyString(), anyList());
    }

    @Test
    void aMalformedAnswerForOnePageDoesNotStopTheOthers() {
        when(client.embed(anyString(), anyList()))
            .thenThrow(new LlmApiException(0, "embeddings: malformed response"))
            .thenAnswer(inv -> {
                List<String> in = inv.getArgument(1);
                return in.stream().map(t -> new float[768]).toList();
            });

        var r = service.embedPending();

        assertThat(r.failed()).isEqualTo(1);
        verify(client, times(2)).embed(anyString(), anyList());
    }

    @Test
    void anUnknownModelStopsTheSweepAfterOneRequest() {
        when(client.embed(anyString(), anyList())).thenThrow(new LlmApiException(404, "embeddings -> 404: no model"));

        var r = service.embedPending();

        assertThat(r.embedded()).isZero();
        assertThat(r.failed()).isEqualTo(1);
        verify(client, times(1)).embed(anyString(), anyList());
    }

    @Test
    void aWrongVectorLengthStopsTheSweep() {
        when(client.embed(anyString(), anyList())).thenAnswer(inv -> {
            List<String> in = inv.getArgument(1);
            return in.stream().map(t -> new float[1024]).toList();
        });

        assertThat(service.embedPending().failed()).isEqualTo(1);
        verify(client, times(1)).embed(anyString(), anyList());
        verify(chunks, never()).insert(any(), anyInt(), anyInt(), any(), any(), any(), any(), any());
    }

    @Test
    void aPageLevelErrorSkipsOnlyThatPage() {
        when(client.embed(anyString(), anyList())).thenThrow(new LlmApiException(400, "embeddings -> 400: input"));

        var r = service.embedPending();

        assertThat(r.failed()).isEqualTo(2);
        verify(client, times(2)).embed(anyString(), anyList());
    }
}
