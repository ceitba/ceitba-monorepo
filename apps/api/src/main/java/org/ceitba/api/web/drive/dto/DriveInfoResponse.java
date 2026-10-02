package org.ceitba.api.web.drive.dto;

// GET /v1/me/drive/info: who to share with and what the student consents to.
public record DriveInfoResponse(String botEmail, String consentVersion, String consentText) {}
