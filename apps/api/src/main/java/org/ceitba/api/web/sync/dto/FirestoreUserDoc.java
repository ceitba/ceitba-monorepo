package org.ceitba.api.web.sync.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

// One 'Usuarios/{uid}' document. `id` is the Firebase Auth uid. `degree` is
// the career as the old app stored it: ITBA's full career name, the app's own
// abbreviated label, or a legacy entrance-program value. fileNo, events and
// notifications are not imported (the user enters the file number once via
// PATCH /v1/me/profile).
@JsonIgnoreProperties(ignoreUnknown = true)
public record FirestoreUserDoc(
    String id,
    String email,
    String name,
    String degree,
    String plan,
    Boolean moderator,
    SocialMedia socialMedia
) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SocialMedia(String linkedin, String instagram, String discord) {}
}
