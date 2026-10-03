package org.ceitba.api.service.drive;

import org.ceitba.api.external.drive.DriveApiException;
import org.ceitba.api.external.drive.DriveClient;
import org.ceitba.api.external.drive.DriveItem;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

// One slice of a source's resumable BFS walk (docs/DRIVE-SYNC.md, "Resumable
// walk"). It starts from the persisted frontier ("<depth>/<folder id>") and
// the ids already seen in this generation (drive_file.seen_generation), so a
// folder is listed at most once per generation even across runs, and stops
// at `until`, leaving the rest of the frontier for the next run.
//
// Loops are impossible: an item (folder or shortcut target) already seen in
// the generation is skipped; shortcuts to the source's root or any folder
// above it are never followed; in community sources shortcuts into the
// archive (another subject's folder) are skipped. Hard caps: maxItems per
// generation and maxDepth; hitting one ends the generation with a warning
// and marks it incomplete (nothing is removed). Shortcuts are only followed
// to items the source's owner (the student, or the archive's owner) owns.
// Not a bean: DriveSyncService creates one per slice.
final class DriveWalker {

    // What a slice needs to know about the source.
    record Context(String rootId, String ownerEmail, boolean community, String communityRootId,
                   Set<String> rootAncestors) {}

    // Result of a slice: items found, the frontier left (empty = generation
    // done) and whether something was skipped.
    record Result(List<DriveSyncStore.WalkedItem> walked, List<String> frontier, boolean incomplete,
                  String warning, int skippedShortcuts) {
        boolean done() { return frontier.isEmpty(); }
    }

    private final DriveClient drive;
    private final Clock clock;
    private final int maxItems;
    private final int maxDepth;
    // Drive id -> parents, for the community "is it inside the archive" check.
    private final Map<String, List<String>> parentsCache = new HashMap<>();

    DriveWalker(DriveClient drive, Clock clock, int maxItems, int maxDepth) {
        this.drive = drive;
        this.clock = clock;
        this.maxItems = maxItems;
        this.maxDepth = maxDepth;
    }

    static String entry(int depth, String folderId) {
        return depth + "/" + folderId;
    }

    // `seen`: ids already reached in this generation (excluding the root).
    Result walk(Context ctx, Collection<String> frontierIn, Collection<String> seenIn, Instant until) {
        var frontier = new ArrayDeque<>(frontierIn);
        var seen = new HashSet<>(seenIn);
        int count = seen.size();
        seen.add(ctx.rootId());
        var out = new ArrayList<DriveSyncStore.WalkedItem>();
        boolean incomplete = false;
        String warning = null;
        int skippedShortcuts = 0;
        outer:
        while (!frontier.isEmpty()) {
            if (clock.instant().isAfter(until)) break;
            var head = frontier.peek();
            int slash = head.indexOf('/');
            int depth = Integer.parseInt(head.substring(0, slash));
            var folderId = head.substring(slash + 1);
            List<DriveItem> children;
            try {
                children = drive.listChildren(folderId);
            } catch (DriveApiException e) {
                if (e.isNotFoundOrForbidden() && !folderId.equals(ctx.rootId())) {
                    frontier.poll();
                    incomplete = true;
                    continue;
                }
                throw e;
            }
            frontier.poll();
            var parent = folderId.equals(ctx.rootId()) ? null : folderId;
            for (var child : children) {
                var item = child;
                if (child.isShortcut()) {
                    item = resolveShortcut(child, ctx);
                    if (item == null) {
                        skippedShortcuts++;
                        continue;
                    }
                }
                if (seen.contains(item.id())) continue;
                var kind = DriveKinds.of(item.mimeType(), item.name(), !ctx.community());
                if (kind.isEmpty()) continue;
                if (count >= maxItems) {
                    incomplete = true;
                    warning = "Walk stopped at " + maxItems + " items (DRIVE_SYNC_MAX_ITEMS_PER_SOURCE)";
                    frontier.clear();
                    break outer;
                }
                seen.add(item.id());
                count++;
                out.add(new DriveSyncStore.WalkedItem(item, parent, kind.get()));
                if (item.isFolder()) {
                    if (depth + 1 > maxDepth) {
                        incomplete = true;
                        warning = "Folders deeper than " + maxDepth + " levels were not listed (DRIVE_SYNC_MAX_DEPTH)";
                    } else {
                        frontier.add(entry(depth + 1, item.id()));
                    }
                }
            }
        }
        return new Result(out, List.copyOf(frontier), incomplete, warning, skippedShortcuts);
    }

    // The shortcut's target as if it sat where the shortcut is, or null
    // (skipped) when: the bot cannot read it, the source's owner does not own
    // it (the bot can read files other students shared with it, and a
    // shortcut must never republish those under this source), it is the
    // source's root or a folder above it, or (community) it lies inside the
    // archive, i.e. in another subject's folder.
    DriveItem resolveShortcut(DriveItem shortcut, Context ctx) {
        var targetId = shortcut.shortcutTargetId();
        if (targetId == null || ctx.ownerEmail() == null) return null;
        if (targetId.equals(ctx.rootId()) || ctx.rootAncestors().contains(targetId)) return null;
        DriveItem target;
        try {
            target = drive.getFile(targetId);
        } catch (DriveApiException e) {
            if (e.isNotFoundOrForbidden()) return null;
            throw e;
        }
        if (target.isShortcut() || !target.ownedBy(ctx.ownerEmail())) return null;
        if (ctx.community() && ctx.communityRootId() != null && isUnder(target, ctx.communityRootId())) return null;
        return target;
    }

    // Whether `ancestorId` is above `item` (up to maxDepth levels).
    private boolean isUnder(DriveItem item, String ancestorId) {
        var parents = item.parents();
        var visited = new HashSet<String>();
        for (int level = 0; level < maxDepth && !parents.isEmpty(); level++) {
            if (parents.contains(ancestorId)) return true;
            var next = parents.get(0);
            if (!visited.add(next)) return false;
            parents = parentsOf(next);
        }
        return false;
    }

    private List<String> parentsOf(String id) {
        var cached = parentsCache.get(id);
        if (cached != null) return cached;
        List<String> parents;
        try {
            parents = drive.getFile(id).parents();
        } catch (DriveApiException e) {
            if (!e.isNotFoundOrForbidden()) throw e;
            parents = List.of();
        }
        parentsCache.put(id, parents);
        return parents;
    }

    // The folders above the root, nearest first (stops where the bot cannot
    // read further, e.g. the student's "My Drive").
    List<String> rootAncestors(DriveItem root) {
        var out = new ArrayList<String>();
        var parents = root.parents();
        for (int level = 0; level < maxDepth && !parents.isEmpty(); level++) {
            var p = parents.get(0);
            if (out.contains(p)) break;
            out.add(p);
            parents = parentsOf(p);
        }
        return out;
    }
}
