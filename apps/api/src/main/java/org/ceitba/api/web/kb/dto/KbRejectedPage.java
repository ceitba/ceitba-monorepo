package org.ceitba.api.web.kb.dto;

import java.util.List;

public record KbRejectedPage(String slug, List<String> errors) {}
