package org.ceitba.api.external.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

// Unauthenticated GET of DO's public model catalog, following links.pages.next
// (at most 10 pages), 20 s timeout per page.
public class HttpDoModelCatalog implements DoModelCatalog {

    static final String URL = "https://api.digitalocean.com/v2/gen-ai/models/catalog";

    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    public HttpDoModelCatalog(ObjectMapper json) {
        this.json = json;
    }

    @Override
    public List<JsonNode> fetch() {
        var out = new ArrayList<JsonNode>();
        String next = URL + "?per_page=200";
        for (int page = 0; page < 10 && next != null; page++) {
            try {
                var res = http.send(HttpRequest.newBuilder(URI.create(next)).timeout(Duration.ofSeconds(20))
                    .header("Accept", "application/json").GET().build(), HttpResponse.BodyHandlers.ofString());
                if (res.statusCode() / 100 != 2) {
                    throw new LlmApiException(res.statusCode(), "DO model catalog -> " + res.statusCode());
                }
                var body = json.readTree(res.body());
                body.path("data").forEach(out::add);
                var n = body.path("links").path("pages").path("next");
                next = n.isTextual() && !n.asText().isBlank() ? n.asText() : null;
            } catch (IOException e) {
                throw new LlmApiException(0, "DO model catalog: " + e.getMessage(), e);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new LlmApiException(0, "Interrupted");
            }
        }
        return out;
    }
}
