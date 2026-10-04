package org.ceitba.api.service.capability;

import java.util.Arrays;
import java.util.Optional;

// Registry of capability keys (docs/CAPABILITIES.md). Add a constant to gate a
// new feature; keys are stored as plain text in the capability_* tables.
public enum Capability {

    APUNTES("apuntes", "Apuntes", "Compartir carpetas de Drive, ver apuntes y wikis por materia"),
    RESUMEN_SEMANAL("resumen_semanal", "Resumen semanal", "Recibir el mail semanal 'La semana en ITBA'");

    private final String key;
    private final String label;
    private final String description;

    Capability(String key, String label, String description) {
        this.key = key;
        this.label = label;
        this.description = description;
    }

    public String key() { return key; }
    public String label() { return label; }
    public String description() { return description; }

    public static Optional<Capability> fromKey(String key) {
        return Arrays.stream(values()).filter(c -> c.key.equals(key)).findFirst();
    }
}
