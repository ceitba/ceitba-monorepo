package org.ceitba.api.web.sync.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

// One 'Benefits/{id}' document. `category` is a BenefitTag key of the old
// app (convenios, idiomas, deportes, comida, ...); `description` is a list
// of bullet lines (a lone string is accepted as a one-item list).
@JsonIgnoreProperties(ignoreUnknown = true)
public record FirestoreBenefitDoc(
    String id,
    String title,
    String category,
    List<String> tags,
    String imageUrl,
    @JsonFormat(with = JsonFormat.Feature.ACCEPT_SINGLE_VALUE_AS_ARRAY)
    List<String> description,
    String location,
    String locationUrl,
    String inscriptionUrl,
    String phone,
    String website,
    String email
) {}
