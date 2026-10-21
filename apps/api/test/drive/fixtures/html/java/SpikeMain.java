package org.ceitba.api.service.drive;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

// Runs the REAL GoogleDocsHtml + DocHtmlSanitizer (jsoup 1.21.2) on inputs.
//   SpikeMain <corpusDir> <outDir>   batch: per-stage files for every corpus file
//   SpikeMain --serve                oracle: stdin lines "<mode>\t<base64 input>",
//                                    stdout lines of tab-separated base64 fields
// Modes: pipe (normalize+sanitize, = production), san (sanitize only),
// pretty (Jsoup.parse(x).body().html(), default pretty print), compact
// (same, prettyPrint false), text (Jsoup.parse(x).text()), cleanfrag (Jsoup.clean
// with the production safelist, compact), norm (normalize only).
public class SpikeMain {
    public static final Map<String, String> ASSETS = new LinkedHashMap<>();
    static {
        ASSETS.put("images/image1.png", "image1.png");
        ASSETS.put("images/image2.jpg", "image2.jpg");
        ASSETS.put("images/image 1.png", "image_1.png");
    }
    static final String PREFIX = "/api/v1/wiki/files/__FILE__/assets/";

    public static void main(String[] a) throws Exception {
        if (a.length > 0 && a[0].equals("--serve")) { serve(); return; }
        var in = Path.of(a[0]); var out = Path.of(a[1]);
        Files.createDirectories(out);
        try (var s = Files.list(in)) {
            for (var f : s.sorted().toList()) {
                var name = f.getFileName().toString().replace(".html", "");
                var raw = Files.readString(f, StandardCharsets.UTF_8);
                var norm = GoogleDocsHtml.normalize(raw);
                w(out, name + ".norm.html", norm == null ? "<null>" : norm);
                var r = DocHtmlSanitizer.sanitize(norm, ASSETS, PREFIX);
                w(out, name + ".pipe.html", r.html());
                w(out, name + ".pipe.txt", r.text() + "\n--assets--\n" + String.join(",", r.usedAssets()));
                w(out, name + ".pipe.sha", sha(r.html()));
                // stage: what the cleaner receives (doc.body().html(), pretty)
                var d = Jsoup.parse(norm == null ? "" : norm);
                w(out, name + ".stage2.html", d.body().html());
                // oracle: compact normalize output fed to sanitize
                var dn = Jsoup.parse(norm == null ? "" : norm);
                dn.outputSettings().prettyPrint(false);
                var rc = DocHtmlSanitizer.sanitize(dn.outerHtml(), ASSETS, PREFIX);
                w(out, name + ".compactnorm.html", rc.html());
                var r2 = DocHtmlSanitizer.sanitize(raw, ASSETS, PREFIX);
                w(out, name + ".san.html", r2.html());
                w(out, name + ".san.txt", r2.text() + "\n--assets--\n" + String.join(",", r2.usedAssets()));
                w(out, name + ".rawtext.txt", Jsoup.parse(raw).text());
            }
        }
    }

    static String run(String mode, String x) {
        switch (mode) {
            case "pipe": {
                var r = DocHtmlSanitizer.sanitize(GoogleDocsHtml.normalize(x), ASSETS, PREFIX);
                return r.html() + "\u0000" + r.text() + "\u0000" + String.join(",", r.usedAssets());
            }
            case "san": {
                var r = DocHtmlSanitizer.sanitize(x, ASSETS, PREFIX);
                return r.html() + "\u0000" + r.text() + "\u0000" + String.join(",", r.usedAssets());
            }
            case "norm": return String.valueOf(GoogleDocsHtml.normalize(x));
            case "unwrap": return DocHtmlSanitizer.unwrapGoogleRedirect(x);
            case "pretty": return Jsoup.parse(x).body().html();
            case "compact": { var d = Jsoup.parse(x); d.outputSettings().prettyPrint(false); return d.body().html(); }
            case "text": return Jsoup.parse(x).text();
            default: throw new IllegalArgumentException(mode);
        }
    }

    static void serve() throws IOException {
        var in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        var out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
        var dec = Base64.getDecoder(); var enc = Base64.getEncoder();
        for (String line; (line = in.readLine()) != null; ) {
            var tab = line.indexOf('\t');
            String res;
            try {
                res = "OK\t" + enc.encodeToString(run(line.substring(0, tab),
                    new String(dec.decode(line.substring(tab + 1)), StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8));
            } catch (Exception e) {
                res = "ERR\t" + enc.encodeToString(String.valueOf(e).getBytes(StandardCharsets.UTF_8));
            }
            out.println(res);
        }
    }

    static String sha(String html) throws Exception {
        var md = MessageDigest.getInstance("SHA-256");
        return HexFormat.of().formatHex(md.digest(("doc\n" + html).getBytes(StandardCharsets.UTF_8)));
    }
    static void w(Path dir, String n, String s) throws Exception {
        Files.write(dir.resolve(n), s.getBytes(StandardCharsets.UTF_8)); // same lossy encode as the digest
    }
}
