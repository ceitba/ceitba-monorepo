// The subset of CEITBA API response shapes the tools read. Field names match
// the API exactly (the subjects catalog is snake_case, everything else camelCase).

export interface UserMe {
  id: string;
  name: string;
  email: string;
  role: "user" | "staff";
  moderator: boolean;
  language: string | null;
  careerId: string | null;
  plan: string | null;
  organizations: { slug: string; role: string }[];
  follows: string[];
  capabilities: string[];
  // Scopes of the API key the request used; null/absent for sessions.
  apiKeyScopes?: string[] | null;
}

export interface TokenResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: UserMe;
}

export interface ApiKeyCreated {
  id: string;
  name: string;
  key: string;
  expiresAt: string;
  scopes: string[];
}

export interface Career {
  id: string;
  name: string;
  plans: string[];
}

export interface ScheduleEntry {
  day: string;
  classroom: string | null;
  building: string | null;
  time_from: string;
  time_to: string;
}

export interface CatalogCorrection {
  id: string;
  status: string;
  schedule: ScheduleEntry[];
  confirms: number;
  rejects: number;
  my_vote: string | null;
  created_at: string;
}

export interface CatalogCommission {
  commission_id?: string;
  name: string;
  schedule: ScheduleEntry[];
  sga_schedule?: ScheduleEntry[];
  corrections?: CatalogCorrection[];
}

export interface CatalogSubject {
  section: string;
  subject_id: string;
  name: string;
  credits: number;
  dependencies: string[];
  credits_required: number | null;
  course_start: string;
  course_end: string;
  commissions: CatalogCommission[];
}

// GET /v1/subjects?plan= : section -> year -> semester -> subjects
export type SubjectCatalog = Record<string, Record<string, Record<string, CatalogSubject[]>>>;

export interface Page<T> {
  data: T[];
  meta: { total: number; page: number; limit: number };
}

export interface ItemsPage<T> {
  items: T[];
  total: number;
}
