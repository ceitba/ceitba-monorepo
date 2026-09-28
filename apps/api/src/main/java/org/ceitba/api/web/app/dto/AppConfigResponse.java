package org.ceitba.api.web.app.dto;

public record AppConfigResponse(String minVersion, String latestVersion, boolean maintenance) {}
