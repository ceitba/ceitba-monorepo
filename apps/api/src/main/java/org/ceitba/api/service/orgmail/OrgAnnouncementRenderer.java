package org.ceitba.api.service.orgmail;

import org.springframework.web.util.HtmlUtils;

import java.util.ArrayList;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// The email of an organization's announcement: the org's name on a band of
// its color, the body as written (plain text: escaped, blank lines start a
// paragraph, http(s) URLs become links; never raw HTML) and a footer with
// the one-click unsubscribe link.
public final class OrgAnnouncementRenderer {

    public record Rendered(String html, String text) {}

    private static final Pattern URL = Pattern.compile("https?://[^\\s<>\"]+[^\\s<>\"'.,;:!?)\\]]");
    private static final Map<String, String> COLORS = Map.of(
        "blue", "#1A3C6E", "amber", "#B87005", "green", "#047857", "violet", "#6D28D9");

    private OrgAnnouncementRenderer() {}

    public static Rendered render(String orgName, String color, String body, String unsubscribeUrl, String portalUrl) {
        String band = COLORS.getOrDefault(color == null ? "" : color, COLORS.get("blue"));
        var paragraphs = new ArrayList<String>();
        for (String p : body.strip().split("\\R\\s*\\R")) {
            if (p.isBlank()) continue;
            paragraphs.add("<p style=\"margin:0 0 16px;line-height:1.6\">"
                + linkify(p.strip()).replaceAll("\\R", "<br>") + "</p>");
        }
        String name = HtmlUtils.htmlEscape(orgName);
        String html = """
            <!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f5f3ef">
            <div style="max-width:600px;margin:0 auto;font-family:Georgia,serif;color:#1c1917">
            <div style="background:%s;color:#ffffff;padding:20px 24px;font:bold 20px Georgia,serif">%s</div>
            <div style="background:#ffffff;padding:24px;font-size:16px">%s</div>
            <div style="padding:16px 24px;font:12px/1.5 Arial,sans-serif;color:#57534e">
            Recibís este correo porque seguís a <a href="%s" style="color:#57534e">%s</a> en ITBA News.
            <a href="%s" style="color:#57534e">Dejar de recibir correos de %s</a>.
            </div></div></body></html>
            """.formatted(band, name, String.join("\n", paragraphs), HtmlUtils.htmlEscape(portalUrl), name,
                HtmlUtils.htmlEscape(unsubscribeUrl), name);
        String text = orgName + "\n\n" + body.strip() + "\n\n--\nRecibís este correo porque seguís a " + orgName
            + " en ITBA News. Dejar de recibir sus correos: " + unsubscribeUrl + "\n";
        return new Rendered(html, text);
    }

    // Escapes `text` and links its URLs. URLs are found in the raw text, so
    // one in quotes or angle brackets doesn't swallow the escaped delimiter.
    static String linkify(String text) {
        Matcher m = URL.matcher(text);
        var out = new StringBuilder();
        int last = 0;
        while (m.find()) {
            String url = HtmlUtils.htmlEscape(m.group());
            out.append(HtmlUtils.htmlEscape(text.substring(last, m.start())))
                .append("<a href=\"").append(url).append("\" style=\"color:#1A3C6E\">").append(url).append("</a>");
            last = m.end();
        }
        return out.append(HtmlUtils.htmlEscape(text.substring(last))).toString();
    }
}
