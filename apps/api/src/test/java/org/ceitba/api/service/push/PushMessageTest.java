package org.ceitba.api.service.push;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PushMessageTest {

    @Test
    void forResourceCarriesTypeAndId() {
        var m = PushMessage.forResource("CEITBA", "Hola", "article", "a1");
        assertThat(m.data()).containsExactlyInAnyOrderEntriesOf(Map.of("type", "article", "id", "a1"));
    }

    @Test
    void titleAndBodyAreRequired() {
        assertThatThrownBy(() -> new PushMessage(" ", "b", null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PushMessage("t", null, null)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void dataIsCopiedImmutableAndDropsNullValues() {
        var src = new HashMap<String, String>();
        src.put("type", "article");
        src.put("id", null);
        var m = new PushMessage("t", "b", src);
        src.put("later", "x");

        assertThat(m.data()).containsExactly(Map.entry("type", "article"));
        assertThatThrownBy(() -> m.data().put("k", "v")).isInstanceOf(UnsupportedOperationException.class);
        assertThat(new PushMessage("t", "b", null).data()).isEmpty();
    }
}
