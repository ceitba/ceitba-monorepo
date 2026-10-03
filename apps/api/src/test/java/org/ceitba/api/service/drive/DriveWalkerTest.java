package org.ceitba.api.service.drive;

import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.external.drive.DriveClient;
import org.ceitba.api.external.drive.DriveItem;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DriveWalkerTest {

    static final String PDF = "application/pdf";
    static final String ME = "alumno@itba.edu.ar";
    static final Instant T0 = Instant.parse("2026-10-01T12:00:00Z");

    static DriveItem item(String id, String mime, String owner, String targetId, String... parents) {
        return new DriveItem(id, id + ".pdf", mime, List.of(parents), List.of(owner), null, null, 1L, null, targetId,
            null, null);
    }

    static DriveItem folder(String id, String... parents) {
        return item(id, DriveItem.FOLDER_MIME, ME, null, parents);
    }

    static DriveItem shortcut(String id, String target) {
        return item(id, DriveItem.SHORTCUT_MIME, ME, target);
    }

    // Instant T0 for the first `calls` reads, a day later afterwards.
    static Clock stoppingAfter(int calls) {
        var n = new AtomicInteger();
        return new Clock() {
            public ZoneId getZone() { return ZoneOffset.UTC; }
            public Clock withZone(ZoneId zone) { return this; }
            public Instant instant() { return n.incrementAndGet() <= calls ? T0 : T0.plus(Duration.ofDays(1)); }
        };
    }

    @Test
    void walkResumesAcrossRunsWithoutLoopsAndOnlyACleanCompleteGenerationRemoves() {
        // P > R (root) > A, B;  A > a1, shortcut to R, shortcut to B, shortcut to another student's file;
        // B > C, shortcut to P (above the root);  C > c1, shortcut to a shortcut.
        var drive = mock(DriveClient.class);
        when(drive.getFile("R")).thenReturn(folder("R", "P"));
        when(drive.getFile("P")).thenReturn(folder("P"));
        when(drive.getFile("B")).thenReturn(folder("B", "R"));
        when(drive.getFile("other")).thenReturn(item("other", PDF, "otro@itba.edu.ar", null));
        when(drive.getFile("sX")).thenReturn(shortcut("sX", "a1"));
        when(drive.listChildren("R")).thenReturn(List.of(folder("A", "R"), folder("B", "R")));
        when(drive.listChildren("A")).thenReturn(List.of(item("a1", PDF, ME, null), shortcut("sR", "R"),
            shortcut("sB", "B"), shortcut("sO", "other")));
        when(drive.listChildren("B")).thenReturn(List.of(folder("C", "B"), shortcut("sP", "P")));
        when(drive.listChildren("C")).thenReturn(List.of(item("c1", PDF, ME, null), shortcut("sY", "sX")));

        // Run 1: time for one folder only.
        var first = new DriveWalker(drive, stoppingAfter(1), 100, 30);
        var ancestors = first.rootAncestors(drive.getFile("R"));
        assertThat(ancestors).containsExactly("P");
        var ctx = new DriveWalker.Context("R", ME, false, null, Set.copyOf(ancestors));
        var r1 = first.walk(ctx, List.of(DriveWalker.entry(0, "R")), List.of(), T0);
        assertThat(r1.walked()).extracting(w -> w.item().id()).containsExactly("A", "B");
        assertThat(r1.frontier()).containsExactly("1/A", "1/B");
        assertThat(r1.done()).isFalse();

        // Run 2 resumes from the persisted frontier and seen ids.
        var seen = r1.walked().stream().map(w -> w.item().id()).toList();
        var second = new DriveWalker(drive, Clock.fixed(T0, ZoneOffset.UTC), 100, 30);
        var r2 = second.walk(ctx, r1.frontier(), seen, T0.plusSeconds(60));
        assertThat(r2.walked()).extracting(w -> w.item().id()).containsExactly("a1", "C", "c1");
        assertThat(r2.done()).isTrue();
        assertThat(r2.incomplete()).isFalse();
        // Shortcuts to the root, to a folder above it, to another student's file and to another
        // shortcut are skipped (4); the one to an already seen folder is deduplicated. Every folder is
        // listed once.
        assertThat(r2.skippedShortcuts()).isEqualTo(4);
        verify(drive, times(1)).listChildren("R");
        verify(drive, times(1)).listChildren("B");

        // Item cap: the generation ends at once, incomplete, with a warning.
        var capped = new DriveWalker(drive, Clock.fixed(T0, ZoneOffset.UTC), 3, 30)
            .walk(ctx, List.of(DriveWalker.entry(0, "R")), List.of(), T0.plusSeconds(60));
        assertThat(capped.walked()).hasSize(3);
        assertThat(capped.done()).isTrue();
        assertThat(capped.incomplete()).isTrue();
        assertThat(capped.warning()).contains("DRIVE_SYNC_MAX_ITEMS_PER_SOURCE");

        // Removal after a complete generation 2: only live rows it did not reach.
        var reached = file(2L, false);
        var missed = file(1L, false);
        var neverSeen = file(null, false);
        var alreadyRemoved = file(1L, true);
        assertThat(DriveSyncStore.removable(reached, 2)).isFalse();
        assertThat(DriveSyncStore.removable(missed, 2)).isTrue();
        assertThat(DriveSyncStore.removable(neverSeen, 2)).isTrue();
        assertThat(DriveSyncStore.removable(alreadyRemoved, 2)).isFalse();
    }

    private static DriveFile file(Long seenGeneration, boolean removed) {
        var f = new DriveFile(UUID.randomUUID(), "d-" + UUID.randomUUID());
        f.setSeenGeneration(seenGeneration);
        if (removed) f.setRemoved(T0.atOffset(ZoneOffset.UTC), null);
        return f;
    }

    @Test
    void shortcutIsFollowedOnlyToItemsTheOwnerOwns() {
        var drive = mock(DriveClient.class);
        var walker = new DriveWalker(drive, Clock.systemUTC(), 100, 30);
        when(drive.getFile("own-file-0001")).thenReturn(item("own-file-0001", PDF, "Alumno@itba.edu.ar", null));
        when(drive.getFile("other-file-01")).thenReturn(item("other-file-01", PDF, "otro@itba.edu.ar", null));
        var ctx = new DriveWalker.Context("R", ME, false, null, Set.of());

        assertThat(walker.resolveShortcut(shortcut("sc-1", "own-file-0001"), ctx))
            .extracting(DriveItem::id).isEqualTo("own-file-0001");
        // Another student's file the bot can read: never pulled into this source.
        assertThat(walker.resolveShortcut(shortcut("sc-2", "other-file-01"), ctx)).isNull();
        // Unknown owner (account gone): nothing is followed.
        assertThat(walker.resolveShortcut(shortcut("sc-1", "own-file-0001"),
            new DriveWalker.Context("R", null, false, null, Set.of()))).isNull();
    }
}
