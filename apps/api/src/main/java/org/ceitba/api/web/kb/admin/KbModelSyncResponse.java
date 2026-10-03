package org.ceitba.api.web.kb.admin;

import java.util.List;

// added: ids found on DO and added to the catalog (disabled, no price).
public record KbModelSyncResponse(List<String> added, int available) {}
