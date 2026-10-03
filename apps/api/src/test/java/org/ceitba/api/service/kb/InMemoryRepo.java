package org.ceitba.api.service.kb;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

// A Spring Data repository interface backed by a map (no Mockito, no DB) for
// unit tests: save/saveAndFlush/saveAll/findById/findAll/findAllById/
// existsById/flush, plus extra methods by name (`on`).
public final class InMemoryRepo<T, ID> {

    public final Map<ID, T> rows = new LinkedHashMap<>();
    private final Function<T, ID> idOf;
    private final Map<String, Function<Object[], Object>> extra = new LinkedHashMap<>();
    private Function<T, T> beforeSave = t -> t;

    public InMemoryRepo(Function<T, ID> idOf) {
        this.idOf = idOf;
    }

    // Runs on every save (e.g. assign ids, enforce a unique key).
    public InMemoryRepo<T, ID> beforeSave(Function<T, T> f) {
        this.beforeSave = f;
        return this;
    }

    public InMemoryRepo<T, ID> on(String method, Function<Object[], Object> f) {
        extra.put(method, f);
        return this;
    }

    @SuppressWarnings("unchecked")
    public <R> R as(Class<R> type) {
        return (R) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, (proxy, m, args) -> {
            var name = m.getName();
            if (extra.containsKey(name)) return extra.get(name).apply(args);
            switch (name) {
                case "save", "saveAndFlush" -> {
                    var t = beforeSave.apply((T) args[0]);
                    rows.put(idOf.apply(t), t);
                    return t;
                }
                case "saveAll" -> {
                    var out = new ArrayList<T>();
                    for (var t : (Iterable<T>) args[0]) {
                        var s = beforeSave.apply(t);
                        rows.put(idOf.apply(s), s);
                        out.add(s);
                    }
                    return out;
                }
                case "findById" -> { return Optional.ofNullable(rows.get((ID) args[0])); }
                case "existsById" -> { return rows.containsKey((ID) args[0]); }
                case "findAll" -> { return new ArrayList<>(rows.values()); }
                case "findAllById" -> {
                    var out = new ArrayList<T>();
                    for (var id : (Iterable<ID>) args[0]) if (rows.containsKey(id)) out.add(rows.get(id));
                    return out;
                }
                case "flush" -> { return null; }
                case "toString" -> { return "InMemoryRepo(" + type.getSimpleName() + ")"; }
                case "hashCode" -> { return System.identityHashCode(proxy); }
                case "equals" -> { return proxy == args[0]; }
                default -> throw new UnsupportedOperationException(type.getSimpleName() + "." + name);
            }
        });
    }

    public List<T> all() {
        return new ArrayList<>(rows.values());
    }
}
