import org.apache.pdfbox.Loader;
import org.apache.pdfbox.io.IOUtils;
import org.apache.pdfbox.text.PDFTextStripper;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.HexFormat;

// Mirrors DriveContentProcessor.pdfInfo + cap() exactly. Usage: PdfboxExtract <outDir> <pdf>...
// Writes <outDir>/<name>.pdfbox.raw.txt (writer output) and prints a TSV line:
// name  status  pages  rawChars  cappedChars  slidesFingerprint  error
public class PdfboxExtract {
    static final int MAX_TEXT_CHARS = 1_000_000;
    static final class CappedWriter extends Writer {
        final StringBuilder sb = new StringBuilder(); final int max;
        CappedWriter(int max) { this.max = max; }
        public void write(char[] b, int off, int len) { int room = max - sb.length(); if (room > 0) sb.append(b, off, Math.min(room, len)); }
        public void flush() {} public void close() {} public String toString() { return sb.toString(); }
    }
    static String cap(String text) {
        if (text == null) return null;
        var t = text.replace("\u0000", "").strip();
        if (t.isEmpty()) return null;
        return t.length() <= MAX_TEXT_CHARS ? t : t.substring(0, MAX_TEXT_CHARS);
    }
    public static void main(String[] a) throws Exception {
        var out = Path.of(a[0]);
        for (int i = 1; i < a.length; i++) {
            var f = new File(a[i]); var name = f.getName().replaceFirst("\\.pdf$", "");
            long t0 = System.nanoTime();
            try (var doc = Loader.loadPDF(f, IOUtils.createTempFileOnlyStreamCache())) {
                var w = new CappedWriter(MAX_TEXT_CHARS + 1);
                new PDFTextStripper().writeText(doc, w);
                var text = w.toString(); int pages = doc.getNumberOfPages();
                Files.writeString(out.resolve(name + ".pdfbox.raw.txt"), text, StandardCharsets.UTF_8);
                var capped = cap(text);
                var d = MessageDigest.getInstance("SHA-256").digest(("pdf\n" + pages + "\n" + text).getBytes(StandardCharsets.UTF_8));
                System.out.printf("%s\tOK\t%d\t%d\t%d\tsha:%s\t%dms%n", name, pages, text.length(), capped == null ? -1 : capped.length(),
                    HexFormat.of().formatHex(d, 0, 16), (System.nanoTime() - t0) / 1_000_000);
            } catch (IOException | RuntimeException e) {
                System.out.printf("%s\tNULL(pdfInfo)\t-\t-\t-\t-\t%s: %s%n", name, e.getClass().getName(), String.valueOf(e.getMessage()).replace('\n', ' '));
            }
        }
    }
}
