package org.ceitba.api.service.drive;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class DriveFolderUrlsTest {

    static final String ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz_-123";

    @Test
    void parsesFolderLinks() {
        assertThat(DriveFolderUrls.parse("https://drive.google.com/drive/folders/" + ID)).contains(ID);
        assertThat(DriveFolderUrls.parse("https://drive.google.com/drive/folders/" + ID + "?usp=sharing")).contains(ID);
        assertThat(DriveFolderUrls.parse("https://drive.google.com/drive/u/1/folders/" + ID + "?usp=drive_link")).contains(ID);
        assertThat(DriveFolderUrls.parse("  drive.google.com/drive/folders/" + ID + "  ")).contains(ID);
    }

    @Test
    void parsesIdQueryParameter() {
        assertThat(DriveFolderUrls.parse("https://drive.google.com/open?id=" + ID)).contains(ID);
        assertThat(DriveFolderUrls.parse("https://drive.google.com/open?usp=x&id=" + ID)).contains(ID);
    }

    @Test
    void acceptsBareIds() {
        assertThat(DriveFolderUrls.parse(ID)).contains(ID);
    }

    @Test
    void rejectsEverythingElse() {
        assertThat(DriveFolderUrls.parse(null)).isEmpty();
        assertThat(DriveFolderUrls.parse("  ")).isEmpty();
        assertThat(DriveFolderUrls.parse("short")).isEmpty();
        assertThat(DriveFolderUrls.parse("https://example.com/drive/folders/" + ID)).isEmpty();
        assertThat(DriveFolderUrls.parse("https://drive.google.com.evil.com/drive/folders/" + ID)).isEmpty();
        assertThat(DriveFolderUrls.parse("https://drive.google.com/drive/my-drive")).isEmpty();
        assertThat(DriveFolderUrls.parse("https://drive.google.com/drive/folders/abc")).isEmpty();
        assertThat(DriveFolderUrls.parse("https://drive.google.com/open?id=<script>")).isEmpty();
        assertThat(DriveFolderUrls.parse("not a url at all with spaces")).isEmpty();
    }
}
