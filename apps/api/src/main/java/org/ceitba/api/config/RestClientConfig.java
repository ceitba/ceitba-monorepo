package org.ceitba.api.config;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.web.client.RestClient;

import java.time.Duration;

@Configuration
public class RestClientConfig {

    @Bean
    public RestClient itbaRestClient(@Value("${itba.api.base-url:}") String baseUrl,
                                     @Value("${itba.api.timeout-millis:30000}") long timeoutMillis) {
        var requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(Duration.ofMillis(timeoutMillis));
        requestFactory.setReadTimeout(Duration.ofMillis(timeoutMillis));

        // ITBA returns single-object-or-array depending on count for fields like
        // section/term/entry/dependency. ACCEPT_SINGLE_VALUE_AS_ARRAY makes Jackson
        // accept either form into a List<>, so the rest of the code only has to
        // handle the array case.
        ObjectMapper mapper = JsonMapper.builder()
            .configure(DeserializationFeature.ACCEPT_SINGLE_VALUE_AS_ARRAY, true)
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
            .build();

        var jsonConverter = new MappingJackson2HttpMessageConverter(mapper);

        return RestClient.builder()
            .baseUrl(baseUrl)
            .requestFactory(requestFactory)
            .messageConverters(converters -> {
                converters.removeIf(c -> c instanceof MappingJackson2HttpMessageConverter);
                converters.add(jsonConverter);
            })
            .build();
    }
}
