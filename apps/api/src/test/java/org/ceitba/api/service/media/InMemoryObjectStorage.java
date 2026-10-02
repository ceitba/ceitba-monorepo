package org.ceitba.api.service.media;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

// Test double of the object store: objects in a map, fake signed URLs
// (https://storage.test/<key>?ttl=<seconds>[&download=<name>]). Import
// InMemoryObjectStorage.Config to make it the ObjectStorage bean.
public class InMemoryObjectStorage implements ObjectStorage {

    @TestConfiguration
    public static class Config {
        @Bean
        @Primary
        public InMemoryObjectStorage inMemoryObjectStorage() {
            return new InMemoryObjectStorage();
        }
    }

    private final Map<String, byte[]> objects = new ConcurrentHashMap<>();
    private final AtomicInteger puts = new AtomicInteger();

    public void clear() {
        objects.clear();
        puts.set(0);
    }

    public Set<String> keys() {
        return new TreeSet<>(objects.keySet());
    }

    public byte[] get(String key) {
        return objects.get(key);
    }

    public int putCount() {
        return puts.get();
    }

    @Override
    public PresignedUpload presignPut(String key, String contentType, long contentLength) {
        throw new UnsupportedOperationException();
    }

    @Override
    public String publicUrl(String key) {
        return "https://storage.test/" + key;
    }

    @Override
    public void put(String key, String contentType, InputStream body, long length) {
        try {
            objects.put(key, body.readNBytes((int) length));
            puts.incrementAndGet();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public void delete(String key) {
        objects.remove(key);
    }

    @Override
    public String presignGet(String key, Duration ttl, String downloadFilename) {
        return "https://storage.test/" + key + "?ttl=" + ttl.toSeconds()
            + (downloadFilename == null ? "" : "&download=" + java.net.URLEncoder.encode(downloadFilename,
                java.nio.charset.StandardCharsets.UTF_8));
    }
}
