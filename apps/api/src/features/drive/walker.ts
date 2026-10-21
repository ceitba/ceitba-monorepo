// service/drive/DriveWalker: one slice of a source's resumable BFS walk
// (docs/DRIVE-SYNC.md "Resumable walk"). Starts from the persisted frontier
// ("<depth>/<folder id>") and the ids already seen in this generation, stops
// at `until`. Loops are impossible (seen set, no shortcut to the root or above
// it, community sources never follow shortcuts into the archive); caps
// maxItems and maxDepth end the generation incomplete with a warning.
// Shortcuts are followed only to items the source's owner owns.

import type { Micros } from '../../lib/time';
import { DriveApiError, isFolder, isShortcut, ownedBy, type DriveClient, type DriveItem } from '../../external/drive';
import { driveKindOf } from './logic/driveKinds';
import type { DriveFileKind } from './logic/types';

export interface WalkContext { rootId: string; ownerEmail: string | null; community: boolean; communityRootId: string | null; rootAncestors: Set<string> }
/** An item found by the walk; parentDriveId null for direct children of the root; shortcuts already resolved. */
export interface WalkedItem { item: DriveItem; parentDriveId: string | null; kind: DriveFileKind }
export interface WalkResult { walked: WalkedItem[]; frontier: string[]; incomplete: boolean; warning: string | null; skippedShortcuts: number }

export const walkDone = (r: WalkResult) => r.frontier.length === 0;
export const entry = (depth: number, folderId: string) => `${depth}/${folderId}`;

const notFoundOrForbidden = (e: unknown) => e instanceof DriveApiError && e.isNotFoundOrForbidden();

export class DriveWalker {
  private readonly parentsCache = new Map<string, string[]>();

  constructor(private readonly drive: DriveClient, private readonly now: () => Micros, private readonly maxItems: number, private readonly maxDepth: number) {}

  /** `seenIn`: ids already reached in this generation (excluding the root). */
  async walk(ctx: WalkContext, frontierIn: string[], seenIn: string[], until: Micros): Promise<WalkResult> {
    const frontier = [...frontierIn];
    const seen = new Set(seenIn);
    let count = seen.size;
    seen.add(ctx.rootId);
    const out: WalkedItem[] = [];
    let incomplete = false;
    let warning: string | null = null;
    let skippedShortcuts = 0;
    outer:
    while (frontier.length) {
      if (this.now() > until) break;
      const head = frontier[0]!;
      const slash = head.indexOf('/');
      const depth = Number.parseInt(head.slice(0, slash), 10);
      const folderId = head.slice(slash + 1);
      let children: DriveItem[];
      try {
        children = await this.drive.listChildren(folderId);
      } catch (e) {
        if (notFoundOrForbidden(e) && folderId !== ctx.rootId) {
          frontier.shift();
          incomplete = true;
          continue;
        }
        throw e;
      }
      frontier.shift();
      const parent = folderId === ctx.rootId ? null : folderId;
      for (const child of children) {
        let item: DriveItem | null = child;
        if (isShortcut(child)) {
          item = await this.resolveShortcut(child, ctx);
          if (item == null) {
            skippedShortcuts++;
            continue;
          }
        }
        if (seen.has(item.id)) continue;
        const kind = driveKindOf(item.mimeType, item.name, !ctx.community);
        if (kind == null) continue;
        if (count >= this.maxItems) {
          incomplete = true;
          warning = `Walk stopped at ${this.maxItems} items (DRIVE_SYNC_MAX_ITEMS_PER_SOURCE)`;
          frontier.length = 0;
          break outer;
        }
        seen.add(item.id);
        count++;
        out.push({ item, parentDriveId: parent, kind });
        if (isFolder(item)) {
          if (depth + 1 > this.maxDepth) {
            incomplete = true;
            warning = `Folders deeper than ${this.maxDepth} levels were not listed (DRIVE_SYNC_MAX_DEPTH)`;
          } else {
            frontier.push(entry(depth + 1, item.id));
          }
        }
      }
    }
    return { walked: out, frontier: [...frontier], incomplete, warning, skippedShortcuts };
  }

  /** The shortcut's target as if it sat where the shortcut is, or null (skipped). */
  async resolveShortcut(shortcut: DriveItem, ctx: WalkContext): Promise<DriveItem | null> {
    const targetId = shortcut.shortcutTargetId;
    if (targetId == null || ctx.ownerEmail == null) return null;
    if (targetId === ctx.rootId || ctx.rootAncestors.has(targetId)) return null;
    let target: DriveItem;
    try {
      target = await this.drive.getFile(targetId);
    } catch (e) {
      if (notFoundOrForbidden(e)) return null;
      throw e;
    }
    if (isShortcut(target) || !ownedBy(target, ctx.ownerEmail)) return null;
    if (ctx.community && ctx.communityRootId != null && (await this.isUnder(target, ctx.communityRootId))) return null;
    return target;
  }

  private async isUnder(item: DriveItem, ancestorId: string): Promise<boolean> {
    let parents = item.parents;
    const visited = new Set<string>();
    for (let level = 0; level < this.maxDepth && parents.length; level++) {
      if (parents.includes(ancestorId)) return true;
      const next = parents[0]!;
      if (visited.has(next)) return false;
      visited.add(next);
      parents = await this.parentsOf(next);
    }
    return false;
  }

  private async parentsOf(id: string): Promise<string[]> {
    const cached = this.parentsCache.get(id);
    if (cached) return cached;
    let parents: string[];
    try {
      parents = (await this.drive.getFile(id)).parents;
    } catch (e) {
      if (!notFoundOrForbidden(e)) throw e;
      parents = [];
    }
    this.parentsCache.set(id, parents);
    return parents;
  }

  /** The folders above the root, nearest first (stops where the bot cannot read further). */
  async rootAncestors(root: DriveItem): Promise<string[]> {
    const out: string[] = [];
    let parents = root.parents;
    for (let level = 0; level < this.maxDepth && parents.length; level++) {
      const p = parents[0]!;
      if (out.includes(p)) break;
      out.push(p);
      parents = await this.parentsOf(p);
    }
    return out;
  }
}
