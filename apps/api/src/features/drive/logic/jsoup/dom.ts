// The tiny DOM the jsoup port works on (spike 4, docs/plans/api-bun-spikes.md):
// elements with ordered attributes, text (with jsoup's DataNode and CDataNode
// flavours) and comments. Built by a tree builder (builders.ts), printed by
// print.ts like jsoup 1.21.2.

export type Node = El | Txt | Cmt;

export class El {
  readonly kind = 'el' as const;
  parent: El | null = null;
  children: Node[] = [];
  /** Unknown/foreign element written as <x/> in the source (jsoup prints "<x />"). */
  selfClosing = false;
  constructor(public name: string, public attrs: [string, string][] = []) {}
  attr(k: string): string {
    return this.attrs.find((a) => a[0] === k)?.[1] ?? '';
  }
  has(k: string): boolean {
    return this.attrs.some((a) => a[0] === k);
  }
  /** Element.attr(k, v): an existing attribute keeps its place, a new one goes last. */
  set(k: string, v: string): void {
    const a = this.attrs.find((x) => x[0] === k);
    if (a) a[1] = v;
    else this.attrs.push([k, v]);
  }
  append(n: Node): Node {
    detach(n);
    n.parent = this;
    this.children.push(n);
    return n;
  }
  elements(): El[] {
    return this.children.filter((c): c is El => c.kind === 'el');
  }
}

/** A text node; `data` = jsoup DataNode (script/style content), `cdata` = CDataNode. */
export class Txt {
  readonly kind = 'txt' as const;
  parent: El | null = null;
  constructor(public value: string, public data = false, public cdata = false) {}
}

/** A comment, or (raw set) another leaf printed verbatim: the doctype. */
export class Cmt {
  readonly kind = 'cmt' as const;
  parent: El | null = null;
  constructor(public value: string, public raw?: string) {}
}

export function detach(n: Node): void {
  if (!n.parent) return;
  const i = n.parent.children.indexOf(n);
  if (i >= 0) n.parent.children.splice(i, 1);
  n.parent = null;
}

export function replaceWith(old: Node, n: Node): void {
  const p = old.parent!;
  const i = p.children.indexOf(old);
  detach(n);
  p.children[i] = n;
  n.parent = p;
  old.parent = null;
}

/** Element.select("*") order: the element itself first, then descendants depth-first. */
export function* descendants(el: El, self = true): Generator<El> {
  if (self) yield el;
  for (const c of [...el.children]) if (c.kind === 'el') yield* descendants(c, true);
}
