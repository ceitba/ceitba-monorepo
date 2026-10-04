package org.ceitba.api.service.digest.personal;

import org.ceitba.api.domain.correction.CorrectionSlot;
import org.ceitba.api.service.digest.DigestPersonalSection;
import org.ceitba.api.service.digest.DigestRenderer;

import java.time.format.TextStyle;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.function.Function;

// Renders "Tu cuatrimestre" as rows of the digest's 600px table (same
// palette and fonts as DigestRenderer) plus its plain-text form. Every
// piece of data goes through DigestRenderer.esc. The suggester of a
// correction is never known here ("Alguien reportó…").
public final class PersonalDigestRenderer {

    // The two vote links of one correction prompt.
    public record VoteLinks(String confirm, String reject) {}

    static final String TITLE = "Tu cuatrimestre";
    static final String CTA = "Armá tu horario en el combinador";
    static final String YES = "Sí, es así";
    static final String NO = "No";
    static final String UPDATED = "actualizado esta semana";

    private static final String PRIMARY = "#1A3C6E";
    private static final String PRIMARY_50 = "#EEF3FA";
    private static final String ACCENT = "#F5A623";
    private static final String INK = "#1C1C1E";
    private static final String INK_2 = "#6B7280";
    private static final String BORDER = "#E5E7EB";
    private static final String BODY = "'Source Sans 3', Lato, 'Helvetica Neue', Helvetica, Arial, sans-serif";
    private static final String MONO = "'JetBrains Mono', Menlo, Consolas, 'Courier New', monospace";
    private static final Locale ES = Locale.forLanguageTag("es-AR");

    private PersonalDigestRenderer() {}

    public static DigestPersonalSection.Section render(PersonalDigest p, String schedulerUrl,
                                                       Function<UUID, VoteLinks> voteLinks) {
        var html = new StringBuilder(2048);
        var text = new StringBuilder(512);
        html.append("<tr><td class=\"px\" style=\"padding:32px 40px 8px 40px;\">")
            .append("<div style=\"font-family:").append(MONO)
            .append(";font-size:12px;letter-spacing:2px;text-transform:uppercase;color:").append(PRIMARY).append(";\">")
            .append(esc(TITLE)).append("</div>")
            .append("<div style=\"border-bottom:1px solid ").append(BORDER).append(";padding-bottom:10px;\"></div>")
            .append("</td></tr>");
        text.append(TITLE.toUpperCase(ES)).append('\n').append("-".repeat(TITLE.length())).append('\n');

        if (p.state() == PersonalDigest.State.NEEDS_SCHEDULE) {
            String msg = "Guardá tu horario de este cuatrimestre como principal y acá vas a ver tus materias, "
                + "sus wikis y los horarios por confirmar.";
            html.append(row(paragraph(msg) + button(schedulerUrl, CTA, true)));
            text.append(msg).append('\n').append(CTA).append(": ").append(schedulerUrl).append('\n');
            return new DigestPersonalSection.Section(html.toString(), text.toString());
        }

        // Subjects
        var sb = new StringBuilder();
        sb.append("<div style=\"font-family:").append(BODY).append(";font-size:15px;line-height:24px;color:")
          .append(INK).append(";\">");
        for (var s : p.subjects()) {
            sb.append("<div style=\"padding:3px 0;\">").append(esc(s.name()));
            if (s.commissionName() != null) {
                sb.append(" <span style=\"font-family:").append(MONO).append(";font-size:12px;color:").append(INK_2)
                  .append(";\">· com. ").append(esc(s.commissionName())).append("</span>");
            }
            sb.append("</div>");
            text.append("* ").append(oneLine(s.name()));
            if (s.commissionName() != null) text.append(" · com. ").append(oneLine(s.commissionName()));
            text.append('\n');
        }
        sb.append("</div>");
        html.append(row(sb.toString()));

        // Wiki links
        if (!p.wiki().isEmpty()) {
            var wb = new StringBuilder();
            wb.append(label("Wikis de tus materias"));
            text.append("\nWikis de tus materias\n");
            for (var w : p.wiki()) {
                wb.append("<div style=\"padding:3px 0;font-family:").append(BODY).append(";font-size:15px;line-height:24px;\">")
                  .append("<a href=\"").append(esc(w.url())).append("\" target=\"_blank\" style=\"color:").append(PRIMARY)
                  .append(";font-weight:600;text-decoration:none;\">").append(esc(w.subjectName())).append(" →</a>");
                if (w.updatedThisWeek()) {
                    wb.append(" <span style=\"font-family:").append(MONO).append(";font-size:11px;letter-spacing:1px;")
                      .append("text-transform:uppercase;color:").append(INK).append(";background:").append(ACCENT)
                      .append(";border-radius:2px;padding:1px 6px;\">").append(esc(UPDATED)).append("</span>");
                }
                wb.append("</div>");
                text.append("* ").append(oneLine(w.subjectName()));
                if (w.updatedThisWeek()) text.append(" (").append(UPDATED).append(")");
                text.append(": ").append(w.url()).append('\n');
            }
            html.append(row(wb.toString()));
        }

        // Corrections to confirm
        if (!p.corrections().isEmpty()) {
            text.append("\nHorarios por confirmar\n");
            var cb = new StringBuilder(label("Horarios por confirmar"));
            for (var c : p.corrections()) {
                String sentence = sentence(c);
                var links = voteLinks.apply(c.correctionId());
                cb.append("<div style=\"background:").append(PRIMARY_50).append(";border-radius:3px;padding:14px 16px;margin:8px 0;\">")
                  .append(paragraph(sentence))
                  .append("<div style=\"padding-top:4px;\">")
                  .append(button(links.confirm(), YES, true))
                  .append("<span style=\"display:inline-block;width:8px;\"></span>")
                  .append(button(links.reject(), NO, false))
                  .append("</div></div>");
                text.append("* ").append(sentence).append('\n')
                    .append("  ").append(YES).append(": ").append(links.confirm()).append('\n')
                    .append("  ").append(NO).append(": ").append(links.reject()).append('\n');
            }
            cb.append("<div style=\"font-family:").append(BODY).append(";font-size:13px;line-height:20px;color:").append(INK_2)
              .append(";padding-top:4px;\">Tu respuesta es anónima. Con 3 confirmaciones el horario corregido se usa en el combinador.</div>");
            text.append("Tu respuesta es anónima. Con 3 confirmaciones el horario corregido se usa en el combinador.\n");
            html.append(row(cb.toString()));
        }
        return new DigestPersonalSection.Section(html.toString(), text.toString());
    }

    // "Alguien reportó que Física I (com. A) se dicta martes 09:00 a 12:00 en
    // vez de lunes 08:00 a 11:00. ¿Es así?"
    static String sentence(PersonalDigest.CorrectionPrompt c) {
        String sga = c.sga().isEmpty() ? "lo que figura en el SGA (sin horarios)" : slots(c.sga());
        return "Alguien reportó que " + oneLine(c.subjectName()) + " (com. " + oneLine(c.commissionName())
            + ") se dicta " + slots(c.proposed()) + " en vez de " + sga + ". ¿Es así?";
    }

    static String slots(List<CorrectionSlot> slots) {
        var parts = slots.stream().map(PersonalDigestRenderer::slot).toList();
        if (parts.size() <= 1) return String.join("", parts);
        return String.join(", ", parts.subList(0, parts.size() - 1)) + " y " + parts.get(parts.size() - 1);
    }

    private static String slot(CorrectionSlot s) {
        String day;
        try {
            day = java.time.DayOfWeek.valueOf(s.day()).getDisplayName(TextStyle.FULL, ES).toLowerCase(ES);
        } catch (IllegalArgumentException e) {
            day = s.day();
        }
        return day + " " + s.from() + " a " + s.to();
    }

    private static String row(String inner) {
        return "<tr><td class=\"px\" style=\"padding:8px 40px;\">" + inner + "</td></tr>";
    }

    private static String label(String s) {
        return "<div style=\"font-family:" + BODY + ";font-size:14px;font-weight:600;color:" + INK_2
            + ";padding:4px 0 2px 0;\">" + esc(s) + "</div>";
    }

    private static String paragraph(String s) {
        return "<p style=\"margin:0 0 10px 0;font-family:" + BODY + ";font-size:15px;line-height:24px;color:" + INK
            + ";\">" + esc(s) + "</p>";
    }

    private static String button(String href, String label, boolean primary) {
        String bg = primary ? PRIMARY : "#FFFFFF";
        String fg = primary ? "#FFFFFF" : PRIMARY;
        return "<a href=\"" + esc(href) + "\" target=\"_blank\" style=\"display:inline-block;font-family:" + BODY
            + ";font-size:14px;font-weight:600;color:" + fg + ";background:" + bg + ";border:1px solid " + PRIMARY
            + ";border-radius:3px;padding:8px 16px;text-decoration:none;\">" + esc(label) + "</a>";
    }

    private static String esc(String s) {
        return DigestRenderer.esc(s);
    }

    private static String oneLine(String s) {
        return s == null ? "" : s.replaceAll("\\s+", " ").strip();
    }
}
