package org.ceitba.api.external.itba;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import org.ceitba.api.common.exception.ExternalApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.net.SocketTimeoutException;
import java.time.Clock;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

// People/student lookups against the ITBA gateway, wire-level. Uses the same
// Jackson settings as RestClientConfig (object-or-array lists). All data here
// is synthetic.
class ItbaStudentLookupTest {

    private static final String BASE = "https://gw.example.test/api/v1";

    private MockRestServiceServer server;
    private RestClientItbaApiClient client;

    @BeforeEach
    void setup() {
        var mapper = JsonMapper.builder()
            .configure(DeserializationFeature.ACCEPT_SINGLE_VALUE_AS_ARRAY, true)
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
            .build();
        var builder = RestClient.builder()
            .baseUrl(BASE)
            .messageConverters(c -> {
                c.removeIf(x -> x instanceof MappingJackson2HttpMessageConverter);
                c.add(new MappingJackson2HttpMessageConverter(mapper));
            });
        server = MockRestServiceServer.bindTo(builder).build();
        client = new RestClientItbaApiClient(builder.build(), "tok", Clock.systemUTC());
    }

    @Test
    void peopleLookupEncodesEmailAndReturnsDni() {
        server.expect(requestTo(BASE + "/people/tok?email=first.last%2Btag%40itba.edu.ar"))
            .andExpect(method(org.springframework.http.HttpMethod.GET))
            .andRespond(withSuccess("{\"dni\":\"00000042\",\"name\":\"x\"}", MediaType.APPLICATION_JSON));

        assertThat(client.findDniByEmail("first.last+tag@itba.edu.ar")).contains("00000042");
        server.verify();
    }

    @Test
    void peopleLookupNumericDniIsAccepted() {
        server.expect(requestTo(BASE + "/people/tok?email=a%40itba.edu.ar"))
            .andRespond(withSuccess("{\"dni\":42}", MediaType.APPLICATION_JSON));
        assertThat(client.findDniByEmail("a@itba.edu.ar")).contains("42");
    }

    @Test
    void peopleLookupNotFoundOrBlankIsEmpty() {
        server.expect(requestTo(BASE + "/people/tok?email=a%40itba.edu.ar"))
            .andRespond(withStatus(HttpStatus.NOT_FOUND));
        assertThat(client.findDniByEmail("a@itba.edu.ar")).isEmpty();

        server.reset();
        server.expect(requestTo(BASE + "/people/tok?email=b%40itba.edu.ar"))
            .andRespond(withSuccess("{\"dni\":\"  \"}", MediaType.APPLICATION_JSON));
        assertThat(client.findDniByEmail("b@itba.edu.ar")).isEmpty();
    }

    @Test
    void peopleLookupServerErrorIsExternalApiExceptionWithoutPii() {
        server.expect(requestTo(BASE + "/people/tok?email=a%40itba.edu.ar"))
            .andRespond(withServerError());
        assertThatThrownBy(() -> client.findDniByEmail("a@itba.edu.ar"))
            .isInstanceOf(ExternalApiException.class)
            .hasMessageNotContaining("a@itba.edu.ar");
    }

    @Test
    void lookupFailuresNeverCarryTokenEmailOrDniInTheCauseChain() {
        // 500 with a body echoing the request data.
        server.expect(requestTo(BASE + "/people/tok?email=a%40itba.edu.ar"))
            .andRespond(withServerError().body("tok a@itba.edu.ar 00000042")
                .contentType(MediaType.TEXT_PLAIN));
        assertNoPii(catchThrowable(() -> client.findDniByEmail("a@itba.edu.ar")), "500");

        // 400 (not 404) with a body.
        server.reset();
        server.expect(requestTo(BASE + "/students/tok/00000042"))
            .andRespond(withStatus(HttpStatus.BAD_REQUEST).body("bad dni 00000042 for tok")
                .contentType(MediaType.TEXT_PLAIN));
        assertNoPii(catchThrowable(() -> client.findStudentByDni("00000042")), "400");

        // Timeout / I/O error: RestClient's message holds the full URL.
        server.reset();
        server.expect(requestTo(BASE + "/students/tok/00000042"))
            .andRespond(request -> { throw new SocketTimeoutException("Read timed out"); });
        assertNoPii(catchThrowable(() -> client.findStudentByDni("00000042")), "ResourceAccessException");

        server.reset();
        server.expect(requestTo(BASE + "/people/tok?email=a%40itba.edu.ar"))
            .andRespond(request -> { throw new SocketTimeoutException("Read timed out"); });
        assertNoPii(catchThrowable(() -> client.findDniByEmail("a@itba.edu.ar")), "ResourceAccessException");
    }

    private static void assertNoPii(Throwable thrown, String expectedDetail) {
        assertThat(thrown).isInstanceOf(ExternalApiException.class);
        assertThat(thrown.getCause()).isNotNull();
        assertThat(thrown.getCause().getMessage()).contains(expectedDetail);
        for (Throwable t = thrown; t != null; t = t.getCause()) {
            assertThat(String.valueOf(t.getMessage()))
                .doesNotContain("a@itba.edu.ar")
                .doesNotContain("a%40itba.edu.ar")
                .doesNotContain("00000042")
                .doesNotContain("tok");
            assertThat(t.getSuppressed()).isEmpty();
        }
    }

    @Test
    void studentLookupSinglePlanObject() {
        server.expect(requestTo(BASE + "/students/tok/00000042"))
            .andRespond(withSuccess("""
                {"code":"60001","career":"Ingeniería en Informática","careerCode":"S",
                 "activeCareerPlans":{"careerPlans":{"name":"S10-Rev23"}}}
                """, MediaType.APPLICATION_JSON));

        var s = client.findStudentByDni("00000042").orElseThrow();
        assertThat(s.fileNumber()).isEqualTo(60001);
        assertThat(s.careerCode()).isEqualTo("S");
        assertThat(s.careerName()).isEqualTo("Ingeniería en Informática");
        assertThat(s.planName()).isEqualTo("S10-Rev23");
    }

    @Test
    void studentLookupPlanArrayTakesFirstNonBlank() {
        server.expect(requestTo(BASE + "/students/tok/7"))
            .andRespond(withSuccess("""
                {"code":"x","careerCode":" I ",
                 "activeCareerPlans":{"careerPlans":[{"name":""},{"name":"I22"},{"name":"I-13"}]}}
                """, MediaType.APPLICATION_JSON));

        var s = client.findStudentByDni("7").orElseThrow();
        assertThat(s.fileNumber()).isNull();
        assertThat(s.careerCode()).isEqualTo("I");
        assertThat(s.planName()).isEqualTo("I22");
    }

    @Test
    void studentLookupWithoutActivePlansAndNotFound() {
        server.expect(requestTo(BASE + "/students/tok/7"))
            .andRespond(withSuccess("{\"code\":\"61000\",\"careerCode\":\"K\"}", MediaType.APPLICATION_JSON));
        assertThat(client.findStudentByDni("7").orElseThrow().planName()).isNull();

        server.reset();
        server.expect(requestTo(BASE + "/students/tok/8"))
            .andRespond(withStatus(HttpStatus.NOT_FOUND));
        assertThat(client.findStudentByDni("8")).isEmpty();
    }

    @Test
    void fakeKnowsOnlyTheDemoStudentByDefault() {
        var fake = new FakeItbaApiClient();
        assertThat(fake.findStudentByEmail(FakeItbaApiClient.DEMO_EMAIL)).contains(FakeItbaApiClient.DEMO_STUDENT);
        assertThat(fake.findStudentByEmail("someone@itba.edu.ar")).isEmpty();
        fake.failStudentLookups(true);
        assertThatThrownBy(() -> fake.findStudentByEmail(FakeItbaApiClient.DEMO_EMAIL))
            .isInstanceOf(ExternalApiException.class);
        fake.reset();
        assertThat(fake.findStudentByEmail(FakeItbaApiClient.DEMO_EMAIL)).isPresent();
    }
}
