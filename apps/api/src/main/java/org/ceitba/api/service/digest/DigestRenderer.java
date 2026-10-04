package org.ceitba.api.service.digest;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.TextStyle;
import java.util.List;
import java.util.Locale;

// Renders one reader's digest as table-based, inline-styled HTML (what email
// clients reliably support) plus a plain-text alternative. Warm/editorial
// look of ItbaNews (DESING.md / EDITORIAL_UI_SYSTEM.md) with web-safe font
// fallbacks. Every piece of user content goes through esc()/attr().
public final class DigestRenderer {

    public record Input(String subject,
                        DigestWeek week,
                        String intro,
                        DigestContent.Personal digest,
                        boolean allOrgs,
                        String unsubscribeUrl,
                        String publicBaseUrl) {}

    public record Output(String html, String text) {}

    // Palette (ItbaNews EDITORIAL_UI_SYSTEM.md).
    private static final String PRIMARY = "#1A3C6E";
    private static final String PRIMARY_50 = "#EEF3FA";
    private static final String ACCENT = "#F5A623";
    private static final String ACCENT_50 = "#FEF8EC";
    private static final String SURFACE = "#FAFAF8";
    private static final String INK = "#1C1C1E";
    private static final String INK_2 = "#6B7280";
    private static final String BORDER = "#E5E7EB";

    private static final String DISPLAY = "Fraunces, 'Playfair Display', Georgia, 'Times New Roman', serif";
    private static final String BODY = "'Source Sans 3', Lato, 'Helvetica Neue', Helvetica, Arial, sans-serif";
    private static final String MONO = "'JetBrains Mono', Menlo, Consolas, 'Courier New', monospace";

    private static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm");

    private DigestRenderer() {}

    public static Output render(Input in) {
        return new Output(html(in), text(in));
    }

    // ---------------------------------------------------------------- HTML

    private static String html(Input in) {
        var d = in.digest();
        var sb = new StringBuilder(8192);
        sb.append("<!DOCTYPE html><html lang=\"es\"><head>")
          .append("<meta charset=\"utf-8\">")
          .append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">")
          .append("<meta name=\"color-scheme\" content=\"light\">")
          .append("<title>").append(esc(in.subject())).append("</title>")
          .append("<style>@media only screen and (max-width:620px){")
          .append(".container{width:100% !important}.px{padding-left:20px !important;padding-right:20px !important}")
          .append(".h1{font-size:30px !important;line-height:36px !important}}</style>")
          .append("</head>")
          .append("<body style=\"margin:0;padding:0;background:").append(SURFACE).append(";\">")
          // Preheader (inbox preview line), hidden in the body.
          .append("<div style=\"display:none;max-height:0;overflow:hidden;mso-hide:all;\">")
          .append(esc(preheader(in))).append("</div>")
          .append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background:")
          .append(SURFACE).append(";\"><tr><td align=\"center\" style=\"padding:24px 12px;\">")
          .append("<table role=\"presentation\" class=\"container\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" ")
          .append("style=\"width:600px;max-width:600px;background:#FFFFFF;border:1px solid ").append(BORDER)
          .append(";border-radius:4px;\">");

        header(sb, in);
        if (in.intro() != null && !in.intro().isBlank()) intro(sb, in.intro());

        sectionLabel(sb, "Lo que pasó", "Artículos publicados del " + in.week().rangeLabel());
        if (d.articles().isEmpty()) {
            emptyRow(sb, "Esta semana no hubo artículos nuevos de las organizaciones que seguís.");
        } else {
            for (var a : d.articles()) article(sb, a, in.publicBaseUrl());
        }

        var next = new DigestWeek(in.week().eventsFrom());
        sectionLabel(sb, "Lo que viene", "Eventos del " + next.rangeLabel());
        if (d.events().isEmpty()) {
            emptyRow(sb, "No hay eventos anunciados para la semana que viene.");
        } else {
            for (var e : d.events()) event(sb, e);
            sb.append("<tr><td class=\"px\" style=\"padding:4px 40px 8px 40px;\">")
              .append(link(in.publicBaseUrl() + "/events", "Ver todos los eventos →",
                  "font-family:" + BODY + ";font-size:15px;font-weight:600;color:" + PRIMARY + ";text-decoration:none;"))
              .append("</td></tr>");
        }

        footer(sb, in);
        sb.append("</table></td></tr></table></body></html>");
        return sb.toString();
    }

    private static void header(StringBuilder sb, Input in) {
        sb.append("<tr><td class=\"px\" style=\"background:").append(PRIMARY)
          .append(";padding:32px 40px 28px 40px;border-radius:4px 4px 0 0;border-bottom:4px solid ").append(ACCENT).append(";\">")
          .append("<div style=\"font-family:").append(MONO).append(";font-size:12px;letter-spacing:2px;text-transform:uppercase;color:")
          .append(ACCENT).append(";\">ITBA News · CEITBA</div>")
          .append("<h1 class=\"h1\" style=\"margin:10px 0 6px 0;font-family:").append(DISPLAY)
          .append(";font-size:38px;line-height:44px;font-weight:700;color:#FFFFFF;\">La semana en ITBA</h1>")
          .append("<div style=\"font-family:").append(MONO).append(";font-size:13px;color:#C9D6EA;\">")
          .append(esc(capitalize(in.week().rangeLabel()))).append("</div>")
          .append("</td></tr>");
    }

    private static void intro(StringBuilder sb, String intro) {
        sb.append("<tr><td class=\"px\" style=\"padding:28px 40px 4px 40px;\">")
          .append("<div style=\"font-family:").append(BODY).append(";font-size:17px;line-height:28px;color:").append(INK)
          .append(";border-left:3px solid ").append(ACCENT).append(";background:").append(ACCENT_50)
          .append(";padding:14px 18px;\">")
          .append(multiline(intro))
          .append("</div></td></tr>");
    }

    private static void sectionLabel(StringBuilder sb, String title, String subtitle) {
        sb.append("<tr><td class=\"px\" style=\"padding:32px 40px 8px 40px;\">")
          .append("<div style=\"font-family:").append(MONO).append(";font-size:12px;letter-spacing:2px;text-transform:uppercase;color:")
          .append(PRIMARY).append(";\">").append(esc(title)).append("</div>")
          .append("<div style=\"font-family:").append(BODY).append(";font-size:14px;color:").append(INK_2)
          .append(";padding-top:2px;border-bottom:1px solid ").append(BORDER).append(";padding-bottom:10px;\">")
          .append(esc(subtitle)).append("</div></td></tr>");
    }

    private static void emptyRow(StringBuilder sb, String message) {
        sb.append("<tr><td class=\"px\" style=\"padding:12px 40px;font-family:").append(BODY)
          .append(";font-size:15px;line-height:24px;color:").append(INK_2).append(";\">")
          .append(esc(message)).append("</td></tr>");
    }

    private static void article(StringBuilder sb, DigestContent.Article a, String base) {
        String url = articleUrl(base, a.id());
        sb.append("<tr><td class=\"px\" style=\"padding:16px 40px 8px 40px;\">");
        if (isAbsoluteHttpUrl(a.coverImage())) {
            sb.append("<a href=\"").append(attr(url)).append("\" style=\"text-decoration:none;\">")
              .append("<img src=\"").append(attr(a.coverImage().trim())).append("\" width=\"520\" alt=\"\" ")
              .append("style=\"display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:3px;margin-bottom:12px;\">")
              .append("</a>");
        }
        sb.append("<div style=\"font-family:").append(MONO).append(";font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:")
          .append(INK_2).append(";\">")
          .append(esc(a.organization() != null ? a.organization().name() : "Independiente"));
        if (a.publishedAt() != null) sb.append(" · ").append(esc(shortDate(a.publishedAt())));
        sb.append("</div>")
          .append("<h2 style=\"margin:6px 0 6px 0;font-family:").append(DISPLAY)
          .append(";font-size:22px;line-height:29px;font-weight:700;\">")
          .append(link(url, a.title(), "color:" + INK + ";text-decoration:none;"))
          .append("</h2>");
        if (a.excerpt() != null && !a.excerpt().isBlank()) {
            sb.append("<p style=\"margin:0 0 6px 0;font-family:").append(BODY)
              .append(";font-size:16px;line-height:25px;color:").append(INK_2).append(";\">")
              .append(esc(a.excerpt())).append("</p>");
        }
        sb.append(link(url, "Leer más →",
                "font-family:" + BODY + ";font-size:14px;font-weight:600;color:" + PRIMARY + ";text-decoration:none;"))
          .append("</td></tr>");
    }

    private static void event(StringBuilder sb, DigestContent.Event e) {
        LocalDate date = e.eventDate();
        sb.append("<tr><td class=\"px\" style=\"padding:12px 40px;\">")
          .append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr>")
          // Date block
          .append("<td width=\"64\" valign=\"top\" style=\"width:64px;\">")
          .append("<div style=\"background:").append(PRIMARY_50).append(";border-radius:3px;text-align:center;padding:8px 0;\">")
          .append("<div style=\"font-family:").append(MONO).append(";font-size:11px;letter-spacing:1px;text-transform:uppercase;color:")
          .append(PRIMARY).append(";\">").append(esc(weekdayShort(date))).append("</div>")
          .append("<div style=\"font-family:").append(DISPLAY).append(";font-size:24px;line-height:28px;font-weight:700;color:")
          .append(PRIMARY).append(";\">").append(date.getDayOfMonth()).append("</div>")
          .append("<div style=\"font-family:").append(MONO).append(";font-size:11px;text-transform:uppercase;color:")
          .append(PRIMARY).append(";\">").append(esc(monthShort(date))).append("</div>")
          .append("</div></td>")
          // Details
          .append("<td valign=\"top\" style=\"padding-left:16px;\">")
          .append("<div style=\"font-family:").append(DISPLAY).append(";font-size:18px;line-height:24px;font-weight:700;color:")
          .append(INK).append(";\">").append(esc(e.title())).append("</div>")
          .append("<div style=\"font-family:").append(MONO).append(";font-size:12px;line-height:20px;color:").append(INK_2)
          .append(";padding-top:4px;\">").append(esc(timeRange(e.startTime(), e.endTime())));
        if (e.location() != null && !e.location().isBlank()) sb.append(" · ").append(esc(e.location()));
        sb.append("</div>");
        if (e.organization() != null) {
            sb.append("<div style=\"font-family:").append(BODY).append(";font-size:14px;color:").append(INK_2)
              .append(";padding-top:2px;\">").append(esc(e.organization().name())).append("</div>");
        }
        sb.append("</td></tr></table></td></tr>");
    }

    private static void footer(StringBuilder sb, Input in) {
        String muted = "font-family:" + BODY + ";font-size:13px;line-height:21px;color:" + INK_2 + ";";
        String linkStyle = "color:" + PRIMARY + ";text-decoration:underline;";
        sb.append("<tr><td class=\"px\" style=\"padding:32px 40px 32px 40px;\">")
          .append("<div style=\"border-top:1px solid ").append(BORDER).append(";padding-top:20px;").append(muted).append("\">")
          .append("<p style=\"margin:0 0 10px 0;\">").append(esc(whyLine(in))).append("</p>")
          .append("<p style=\"margin:0 0 10px 0;\">")
          .append(link(in.publicBaseUrl() + "/organizations", "Elegí qué organizaciones seguir", linkStyle))
          .append(" · ")
          .append(link(in.unsubscribeUrl(), "Dejar de recibir este resumen", linkStyle))
          .append("</p>")
          .append("<p style=\"margin:0;\">CEITBA · Centro de Estudiantes del ITBA</p>")
          .append("</div></td></tr>");
    }

    // ---------------------------------------------------------------- text

    private static String text(Input in) {
        var d = in.digest();
        var sb = new StringBuilder(2048);
        sb.append("LA SEMANA EN ITBA\n").append(capitalize(in.week().rangeLabel())).append("\n\n");
        if (in.intro() != null && !in.intro().isBlank()) sb.append(in.intro().strip()).append("\n\n");

        sb.append("LO QUE PASÓ\n").append("-----------\n");
        if (d.articles().isEmpty()) {
            sb.append("Esta semana no hubo artículos nuevos de las organizaciones que seguís.\n");
        }
        for (var a : d.articles()) {
            sb.append("\n* ").append(oneLine(a.title())).append('\n')
              .append("  ").append(a.organization() != null ? oneLine(a.organization().name()) : "Independiente");
            if (a.publishedAt() != null) sb.append(" · ").append(shortDate(a.publishedAt()));
            sb.append('\n');
            if (a.excerpt() != null && !a.excerpt().isBlank()) sb.append("  ").append(oneLine(a.excerpt())).append('\n');
            sb.append("  ").append(articleUrl(in.publicBaseUrl(), a.id())).append('\n');
        }

        sb.append("\nLO QUE VIENE\n").append("------------\n");
        if (d.events().isEmpty()) sb.append("No hay eventos anunciados para la semana que viene.\n");
        for (var e : d.events()) {
            sb.append("\n* ").append(oneLine(e.title())).append('\n')
              .append("  ").append(capitalize(DigestWeek.longDate(e.eventDate())))
              .append(" · ").append(timeRange(e.startTime(), e.endTime()));
            if (e.location() != null && !e.location().isBlank()) sb.append(" · ").append(oneLine(e.location()));
            sb.append('\n');
            if (e.organization() != null) sb.append("  ").append(oneLine(e.organization().name())).append('\n');
        }
        if (!d.events().isEmpty()) sb.append("\nTodos los eventos: ").append(in.publicBaseUrl()).append("/events\n");

        sb.append("\n--\n").append(whyLine(in)).append('\n')
          .append("Elegí qué organizaciones seguir: ").append(in.publicBaseUrl()).append("/organizations\n")
          .append("Dejar de recibir este resumen: ").append(in.unsubscribeUrl()).append('\n');
        return sb.toString();
    }

    // ---------------------------------------------------------------- helpers

    static String whyLine(Input in) {
        if (in.allOrgs()) {
            return "Vista previa: así lo vería alguien que sigue a todas las organizaciones.";
        }
        List<DigestContent.Org> orgs = in.digest().followedOrgs() == null ? List.of() : in.digest().followedOrgs();
        if (orgs.isEmpty()) {
            return "Recibís este resumen semanal de ITBA News porque tenés cuenta en CEITBA.";
        }
        var names = orgs.stream().map(o -> oneLine(o.name())).toList();
        String list = names.size() == 1 ? names.get(0)
            : String.join(", ", names.subList(0, names.size() - 1)) + " y " + names.get(names.size() - 1);
        return "Recibís este resumen semanal de ITBA News porque seguís a "
            + (names.size() == 1 ? "1 organización: " : names.size() + " organizaciones: ") + list + ".";
    }

    private static String preheader(Input in) {
        var d = in.digest();
        if (!d.articles().isEmpty()) return oneLine(d.articles().get(0).title());
        if (!d.events().isEmpty()) return "Lo que viene: " + oneLine(d.events().get(0).title());
        return "Lo que pasó y lo que viene en ITBA";
    }

    static String articleUrl(String base, String id) {
        return base + "/articles/" + URLEncoder.encode(id, StandardCharsets.UTF_8).replace("+", "%20");
    }

    static boolean isAbsoluteHttpUrl(String url) {
        if (url == null) return false;
        String u = url.trim().toLowerCase(Locale.ROOT);
        return (u.startsWith("https://") || u.startsWith("http://")) && u.length() > 8
            && u.chars().noneMatch(c -> Character.isWhitespace(c) || c == '"' || c == '\'' || c == '<' || c == '>');
    }

    private static String link(String href, String label, String style) {
        return "<a href=\"" + attr(href) + "\" target=\"_blank\" style=\"" + style + "\">" + esc(label) + "</a>";
    }

    // Escaped, line breaks kept as <br>.
    static String multiline(String s) {
        return esc(s.strip()).replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br>");
    }

    static String esc(String s) {
        if (s == null) return "";
        var sb = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '&' -> sb.append("&amp;");
                case '<' -> sb.append("&lt;");
                case '>' -> sb.append("&gt;");
                case '"' -> sb.append("&quot;");
                case '\'' -> sb.append("&#39;");
                default -> sb.append(c);
            }
        }
        return sb.toString();
    }

    static String attr(String s) {
        return esc(s);
    }

    private static String oneLine(String s) {
        return s == null ? "" : s.replaceAll("\\s+", " ").strip();
    }

    private static String timeRange(LocalTime start, LocalTime end) {
        if (start == null) return "";
        if (end == null || !end.isAfter(start)) return start.format(HM) + " hs";
        return start.format(HM) + " a " + end.format(HM) + " hs";
    }

    private static String shortDate(LocalDate d) {
        return d.getDayOfMonth() + " " + monthShort(d);
    }

    private static String weekdayShort(LocalDate d) {
        return stripDot(d.getDayOfWeek().getDisplayName(TextStyle.SHORT, DigestWeek.ES));
    }

    private static String monthShort(LocalDate d) {
        return stripDot(d.getMonth().getDisplayName(TextStyle.SHORT, DigestWeek.ES));
    }

    private static String stripDot(String s) {
        return s.replace(".", "").toLowerCase(DigestWeek.ES);
    }

    private static String capitalize(String s) {
        return s == null || s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }
}
