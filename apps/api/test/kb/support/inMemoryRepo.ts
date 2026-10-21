// Port of apps/api/src/test/java/org/ceitba/api/service/kb/InMemoryRepo.java: a repository
// backed by a map (no DB) for unit tests: save/saveAndFlush/saveAll/findById/findAll/
// findAllById/existsById, plus extra methods by name (`on`). Rows are live objects, like
// JPA-managed entities inside a transaction.

type Fn = (args: unknown[]) => unknown;

export class InMemoryRepo<T, ID> {
  readonly rows = new Map<ID, T>();
  private readonly extra = new Map<string, Fn>();
  private beforeSaveFn: (t: T) => T = (t) => t;

  constructor(private readonly idOf: (t: T) => ID) {}

  /** Runs on every save (e.g. assign ids, enforce a unique key). */
  beforeSave(f: (t: T) => T): this {
    this.beforeSaveFn = f;
    return this;
  }

  on(method: string, f: Fn): this {
    this.extra.set(method, f);
    return this;
  }

  all(): T[] {
    return [...this.rows.values()];
  }

  /** The repository view: base methods plus the `on` ones (looked up at call time). */
  as<R>(): R {
    const self = this;
    const base: Record<string, (...a: unknown[]) => unknown> = {
      save: (t) => self.saveOne(t as T),
      saveAndFlush: (t) => self.saveOne(t as T),
      saveAll: (ts) => [...(ts as Iterable<T>)].map((t) => self.saveOne(t)),
      findById: (id) => self.rows.get(id as ID) ?? null,
      existsById: (id) => self.rows.has(id as ID),
      findAll: () => self.all(),
      findAllById: (ids) => [...(ids as Iterable<ID>)].filter((id) => self.rows.has(id)).map((id) => self.rows.get(id)!),
      flush: () => undefined,
    };
    return new Proxy({} as Record<string, unknown>, {
      get(_t, name) {
        if (typeof name !== 'string' || name === 'then') return undefined;
        const ex = self.extra.get(name);
        if (ex) return (...a: unknown[]) => ex(a);
        const b = base[name];
        if (b) return b;
        return () => {
          throw new Error(`UnsupportedOperation: ${name}`);
        };
      },
    }) as R;
  }

  private saveOne(t: T): T {
    const s = this.beforeSaveFn(t);
    this.rows.set(this.idOf(s), s);
    return s;
  }
}
