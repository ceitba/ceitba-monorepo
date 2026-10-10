package org.ceitba.api.service.digest.personal;

import org.ceitba.api.domain.correction.CorrectionSlot;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class PersonalDigestRendererTest {

    static final String SCHEDULER = "https://ceitba.org.ar/app/horario";
    static final UUID CORRECTION = UUID.randomUUID();

    static PersonalDigestRenderer.VoteLinks links(UUID id) {
        return new PersonalDigestRenderer.VoteLinks("https://n/correction?token=t&vote=confirm",
            "https://n/correction?token=t&vote=reject");
    }

    static PersonalDigest current(String subjectName, String commission) {
        return new PersonalDigest(PersonalDigest.State.CURRENT,
            List.of(new PersonalDigest.SubjectLine("93.41", subjectName, commission),
                new PersonalDigest.SubjectLine("93.58", "Matemática", null)),
            List.of(new PersonalDigest.WikiLink("93.41", subjectName, "https://ceitba.org.ar/apuntes/93.41?vista=wiki", true)),
            List.of(new PersonalDigest.CorrectionPrompt(CORRECTION, subjectName, commission,
                List.of(new CorrectionSlot("TUESDAY", "09:00", "12:00"), new CorrectionSlot("WEDNESDAY", "08:00", "10:00")),
                List.of(new CorrectionSlot("MONDAY", "08:00", "11:00")))));
    }

    @Test
    void currentScheduleShowsSubjectsWikiAndCorrections() {
        var s = PersonalDigestRenderer.render(current("Física I", "A"), SCHEDULER, PersonalDigestRendererTest::links);
        assertThat(s.html()).contains("Tu cuatrimestre", "Física I", "com. A", "Matemática",
            "href=\"https://ceitba.org.ar/apuntes/93.41?vista=wiki\"", "actualizado esta semana",
            "Alguien reportó que Física I (com. A) se dicta martes 09:00 a 12:00 y miércoles 08:00 a 10:00 "
                + "en vez de lunes 08:00 a 11:00. ¿Es así?",
            "href=\"https://n/correction?token=t&amp;vote=confirm\"", "Sí, es así",
            "href=\"https://n/correction?token=t&amp;vote=reject\"")
            .startsWith("<tr>").endsWith("</tr>")
            .doesNotContain(SCHEDULER);
        assertThat(s.text()).contains("TU CUATRIMESTRE", "* Física I · com. A",
            "Física I (actualizado esta semana): https://ceitba.org.ar/apuntes/93.41?vista=wiki",
            "Sí, es así: https://n/correction?token=t&vote=confirm",
            "No: https://n/correction?token=t&vote=reject");
    }

    @Test
    void needsScheduleIsJustTheCallToAction() {
        var s = PersonalDigestRenderer.render(PersonalDigest.needsSchedule(), SCHEDULER, PersonalDigestRendererTest::links);
        assertThat(s.html()).contains("Armá tu horario en la app", "href=\"" + SCHEDULER + "\"")
            .doesNotContain("Alguien reportó");
        assertThat(s.text()).contains("Armá tu horario en la app: " + SCHEDULER);
    }

    @Test
    void escapesEverything() {
        var evil = "<script>alert('x')</script>&\"";
        var s = PersonalDigestRenderer.render(current(evil, "<b>A</b>"), SCHEDULER, id ->
            new PersonalDigestRenderer.VoteLinks("https://n/?a=\"><img src=x>", "https://n/?b=1&c=2"));
        assertThat(s.html()).doesNotContain("<script>", "<b>A</b>", "\"><img")
            .contains("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;&quot;", "com. &lt;b&gt;A&lt;/b&gt;",
                "https://n/?a=&quot;&gt;&lt;img src=x&gt;", "https://n/?b=1&amp;c=2");
    }

    @Test
    void slotListsReadNaturally() {
        assertThat(PersonalDigestRenderer.slots(List.of(new CorrectionSlot("SATURDAY", "10:00", "13:00"))))
            .isEqualTo("sábado 10:00 a 13:00");
        assertThat(PersonalDigestRenderer.slots(List.of(new CorrectionSlot("MONDAY", "08:00", "10:00"),
            new CorrectionSlot("TUESDAY", "08:00", "10:00"), new CorrectionSlot("FRIDAY", "18:00", "21:00"))))
            .isEqualTo("lunes 08:00 a 10:00, martes 08:00 a 10:00 y viernes 18:00 a 21:00");
    }
}
