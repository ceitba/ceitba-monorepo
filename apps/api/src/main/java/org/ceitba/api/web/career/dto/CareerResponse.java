package org.ceitba.api.web.career.dto;

import java.util.List;

// Mirrors the NestJS shape: id, name, plans always present (even when empty).
public record CareerResponse(String id, String name, List<String> plans) {}
