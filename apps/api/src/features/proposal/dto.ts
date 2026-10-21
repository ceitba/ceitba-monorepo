// web/proposal/dto/* (+ web/media/dto/SignUploadRequest for the attachment
// sign-upload) and the proposal enums of domain/ and domain/proposal/.

import { z } from 'zod';
import { jv, type ParamSpec } from '../../http/validation';
import { ArgumentTypeMismatchError } from '../../http/errors';
import { javaTrim } from '../../lib/javaCompat';

/** domain/ProposalStatus */
export const PROPOSAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
/** domain/proposal/ProposalTopic */
export const PROPOSAL_TOPICS = ['VIDA_UNIVERSITARIA', 'CEITBA', 'EVENTOS', 'CURSOS', 'OTROS'] as const;
export type ProposalTopic = (typeof PROPOSAL_TOPICS)[number];
/** domain/proposal/ProposalLifecycle */
export const PROPOSAL_LIFECYCLES = ['ABIERTO', 'ACEPTADO', 'CERRADO'] as const;
export type ProposalLifecycle = (typeof PROPOSAL_LIFECYCLES)[number];
/** domain/proposal/ProposalVoteValue */
export const VOTE_VALUES = ['UP', 'DOWN'] as const;
export type ProposalVoteValue = (typeof VOTE_VALUES)[number];

/**
 * A proposal enum in a request body: `@JsonCreator fromJson(String)` =
 * `valueOf(value.trim().toUpperCase(Locale.ROOT))`. Jackson hands the creator
 * any scalar as text (`0` -> "0", `true` -> "true"); an unknown constant, ""
 * or a non-scalar is a binding failure (400 BadRequest). JSON null is null.
 */
function ciEnum<const T extends readonly [string, ...string[]]>(values: T, o: { notNull?: boolean } = {}) {
  const exact = jv.enum(values, o);
  return z.any().transform((v: unknown, ctx) => {
    if (v === undefined || v === null) return v;
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return v; // jv.enum fails the binding
    const upper = javaTrim(String(v)).toUpperCase();
    if (!(values as readonly string[]).includes(upper)) {
      ctx.addIssue({ code: 'custom', message: 'cannot bind enum', params: { java_bind: true } });
      return z.NEVER;
    }
    return upper;
  }).pipe(exact);
}

/**
 * A query-string enum (@RequestParam): Spring's StringToEnumConverterFactory,
 * case-sensitive `Enum.valueOf(type, source.trim())`, "" -> null. `def` is the
 * annotation's defaultValue (used when the parameter is absent or exactly "").
 */
export function queryEnum<const T extends readonly string[]>(values: T, javaType: string, def?: T[number]): ParamSpec<T[number] | null> {
  return {
    javaType,
    parse(raw, name) {
      if (raw === undefined || raw === '') return def ?? null;
      const v = javaTrim(raw); // " " -> valueOf("") fails, like Java
      if ((values as readonly string[]).includes(v)) return v as T[number];
      throw new ArgumentTypeMismatchError(name, raw, javaType,
        `Failed to convert from type [java.lang.String] to type [@org.springframework.web.bind.annotation.RequestParam ${javaType}] for value [${raw}]`);
    },
  };
}

const singleLine = /^[^\r\n]*$/;

/**
 * CreateProposalRequest(@NotBlank @Size(max = 100) @Pattern(regexp = "[^\\r\\n]*", message = "must be a single line") title,
 * @NotBlank @Size(max = 5000) description, @NotNull ProposalTopic topic, @Size(max = 5) List<@NotBlank String> attachmentKeys).
 */
export const CreateProposalRequest = jv.object({
  title: jv.string({ notBlank: true, size: { max: 100 }, check: (s: string) => (singleLine.test(s) ? null : 'must be a single line') }),
  description: jv.string({ notBlank: true, size: { max: 5000 } }),
  topic: ciEnum(PROPOSAL_TOPICS, { notNull: true }),
  attachmentKeys: jv.list(jv.string({ notBlank: true }), { size: { max: 5 } }),
});
export type CreateProposalRequest = NonNullable<z.output<typeof CreateProposalRequest>>;

/** CreateProposalCommentRequest(@NotBlank @Size(max = 1000) body, UUID parentId). */
export const CreateProposalCommentRequest = jv.object({
  body: jv.string({ notBlank: true, size: { max: 1000 } }),
  parentId: jv.uuid(),
});
export type CreateProposalCommentRequest = NonNullable<z.output<typeof CreateProposalCommentRequest>>;

/** ProposalVoteRequest(@NotNull ProposalVoteValue value). */
export const ProposalVoteRequest = jv.object({ value: ciEnum(VOTE_VALUES, { notNull: true }) });

/** RejectProposalRequest(@NotBlank @Size(max = 1024) reason). */
export const RejectProposalRequest = jv.object({ reason: jv.string({ notBlank: true, size: { max: 1024 } }) });

/** UpdateProposalLifecycleRequest(@NotNull ProposalLifecycle lifecycle). */
export const UpdateProposalLifecycleRequest = jv.object({ lifecycle: ciEnum(PROPOSAL_LIFECYCLES, { notNull: true }) });

/** web/media/dto/SignUploadRequest(@NotBlank filename, @NotBlank contentType, @Positive long sizeBytes). */
export const SignUploadRequest = jv.object({
  filename: jv.string({ notBlank: true }),
  contentType: jv.string({ notBlank: true }),
  sizeBytes: jv.long({ positive: true, primitive: true }),
});

/** ProposalAttachmentResponse(int position, String url, String contentType). */
export interface ProposalAttachmentResponse {
  position: number;
  url: string | null;
  contentType: string;
}

/** ProposalResponse, record order. Timestamps are pre-formatted (DB vs in-memory origin). */
export interface ProposalResponse {
  id: string;
  title: string;
  description: string;
  topic: ProposalTopic;
  status: ProposalStatus;
  lifecycle: ProposalLifecycle;
  rejectionReason: string | null;
  attachments: ProposalAttachmentResponse[];
  upCount: number;
  downCount: number;
  commentCount: number;
  myVote: ProposalVoteValue | null;
  isMine: boolean;
  authorAlias: string | null;
  createdAt: string;
  moderatedAt: string | null;
}

/** ProposalCommentResponse, record order. */
export interface ProposalCommentResponse {
  id: string;
  parentId: string | null;
  alias: string | null;
  isMine: boolean;
  isAuthor: boolean;
  body: string | null;
  deleted: boolean;
  createdAt: string;
  replies: ProposalCommentResponse[];
}

/** ProposalVoteResponse(int upCount, int downCount, ProposalVoteValue myVote). */
export interface ProposalVoteResponse {
  upCount: number;
  downCount: number;
  myVote: ProposalVoteValue | null;
}
