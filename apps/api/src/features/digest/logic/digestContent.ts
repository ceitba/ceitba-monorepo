// Port of apps/api/src/main/java/org/ceitba/api/service/digest/DigestContent.java:
// entity-free view of an issue's content.
import type { LocalDate } from '../../../lib/javaCompat';
import type { DigestWeek } from './digestWeek';

export interface DigestOrg { slug: string; name: string }

export interface DigestArticle {
  id: string;
  title: string;
  excerpt: string | null;
  coverImage: string | null;
  publishedAt: LocalDate | null;
  organization: DigestOrg | null;
}

/** signup: people can sign up (RSVP or an external form). Times are `HH:mm[:ss]` strings (TIME columns). */
export interface DigestEvent {
  id: string;
  title: string;
  eventDate: LocalDate;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  organization: DigestOrg | null;
  signup: boolean;
}

/** Every candidate of the week, before staff exclusions. */
export interface DigestCandidates {
  week: DigestWeek;
  articles: DigestArticle[];
  events: DigestEvent[];
}

/** What every recipient gets: the candidates minus staff exclusions. */
export interface DigestShared {
  articles: DigestArticle[];
  events: DigestEvent[];
}

export const isSharedEmpty = (s: DigestShared): boolean => s.articles.length === 0 && s.events.length === 0;
