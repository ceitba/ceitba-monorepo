# Push notifications (FCM)

The API keeps a registry of mobile-app devices (FCM registration tokens) and
sends pushes through the Firebase Admin SDK. The app keeps `firebase_messaging`
only as the delivery transport; nothing is written to Firestore.

## Configuration

| Var | Default | Purpose |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | _(empty)_ | Service-account key JSON of the Firebase project, either raw or base64-encoded (`base64 -i key.json`), which is easier to put in `.env` |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | _(empty)_ | Or: path to that JSON file inside the container (mount it read-only) |

- **Neither set:** pushes are disabled. `NoOpPushNotificationService` (`src/features/push/service.ts`) logs and drops them. This is the default for local dev and tests. Device registration still works.
- **Either set:** `FcmPushNotificationService` is used, over the Firebase gateway in `src/infra/push.ts`. If the credentials can't be read or parsed, **startup fails**. When both are set, the JSON wins.
- **Getting a key:** Firebase console → Project settings → Service accounts → *Generate new private key*. Use the same Firebase project as the app's `google-services.json` / `GoogleService-Info.plist`, otherwise every send fails with `SENDER_ID_MISMATCH`. The key only needs the *Firebase Cloud Messaging API Admin* role. Treat it as a secret.

## Device registry (`/v1/me/devices`, USER)

Table `public.user_devices` (V23): `token` (PK), `user_id`, `platform` (`ios` | `android`), `app_version`, `created_at`, `last_seen_at`.

```http
PUT    /api/v1/me/devices          {"token": "<fcm token>", "platform": "ios", "appVersion": "2.0.0"}
                                   -> 200 {token, platform, appVersion, createdAt, lastSeenAt}
GET    /api/v1/me/devices          -> [ ...same shape, most recently seen first ]
DELETE /api/v1/me/devices/{token}  -> 204
```

- **`PUT`**
  - **When to call:** after login, and on every `onTokenRefresh`.
  - **Behaviour:** an idempotent upsert keyed by token that refreshes `last_seen_at`.
  - **Token owned by another account:** the token moves to the caller (a shared phone or an account switch). The previous owner stops getting pushes on that device.
  - **Validation:** `platform` is case-insensitive. The token may contain only `[A-Za-z0-9_:.-]` and be at most 1024 characters. `appVersion` is at most 32 characters.
  - **Device cap:** each user keeps at most 10 devices. Beyond that, the least recently seen one is dropped.
- **`DELETE`:** call it on logout, **before** dropping the access token. It's always `204`: unknown tokens and other users' tokens are ignored.
- **Account deletion** (`DELETE /v1/me`) removes all of the user's devices.

## Sending

`src/features/push/service.ts`:

- **`PushNotificationService`**
  - Methods: `sendToUsers(userIds, msg)`, `sendToOrgFollowers(slug, msg)`, `broadcast(msg)`.
  - Recipients are resolved to tokens.
  - Sends go out in batches of 500 through `sendEachForMulticast`.
- **`PushMessage`** (`src/features/push/logic/pushMessage.ts`): `title`, `body`, `data`
  - `data` is a string map. By convention it carries `type` and `id`, which the app uses for deep links.
  - `pushForResource(title, body, type, id)` builds one.
  - Every push is an alert with high Android priority; the APNs payload also sets `content-available: 1` so iOS wakes the app in the background to refresh its inbox.
- **Dead tokens.** Tokens that FCM reports as `UNREGISTERED` or `INVALID_ARGUMENT` are deleted from `user_devices`.
  - **Exception:** if *every* token in a batch of two or more fails with `INVALID_ARGUMENT`, the message itself is assumed to be malformed. Nothing is pruned and an error is logged. A lone token failing with `INVALID_ARGUMENT` is pruned.
  - Other errors (quota, `SENDER_ID_MISMATCH`, transient failures) keep the token.
  - There are no retries.
- **Delivery is asynchronous and after commit.** Feature code never calls the service directly. It builds a `PushTrigger` (`pushToUsers`, `pushToOrgFollowers`, `pushBroadcast`) and hands it to `firePush` (or `firePushes` in `src/features/news/pushTriggers.ts`) once its transaction (`withTx`) has returned.
  - `firePush` delivers it in the background: the request never waits on FCM, and failures are logged, never thrown.
  - A rolled-back transaction sends nothing, because the trigger is only fired after the commit.
  - Code that runs outside a transaction fires it right away.
  - The header comment of `src/features/push/service.ts` shows how to add a new trigger.

### Current triggers

| When | Recipients | Notification | `data` |
|---|---|---|---|
| An article is created as `published`, or a draft is patched to `published` (edits never re-notify) | Followers of the article's organization | title = org name, body = article title | `{type: "article", id, org}` |
| A news event is created (events have no draft state) | Followers of the event's organization | title = org name, body = event title | `{type: "event", id, org}` |
| A moderator approves or rejects a proposal, or changes its lifecycle (`ProposalStatusChangedEvent` -> the notifier in `src/features/proposal/events.ts`); setting the lifecycle it already has does not push | The proposal's author (none if they deleted their account) | title = "Tu propuesta fue aprobada" / "rechazada" / "aceptada" / "cerrada" / "volvió a estar abierta", body = proposal title | `{type: "proposal", id}` |
| A student schedule correction becomes APPLIED for the first time (by votes or STAFF; see `docs/SCHEDULE-CORRECTIONS.md`) | The correction's suggester (none if they deleted their account) | title = "Tu corrección fue aplicada", body = "{subject} · Comisión {name}: el horario corregido ya se usa en el Combinador." | `{type: "schedule_correction_applied", correctionId, subjectId, commissionId}` (no `id` key) |
| `POST /v1/staff/push/broadcast` (STAFF) | Every registered device | as given | as given |

Articles or events with no organization do not push.

### STAFF broadcast

```http
POST /api/v1/staff/push/broadcast
{"title": "CEITBA", "body": "Mañana no hay clases", "data": {"type": "announcement", "id": "42"}}
-> 202 (queued)
```

- **Size limits:** `title` ≤ 200 characters and `body` ≤ 1000. `data` is optional, with ≤ 10 entries, keys ≤ 64 and values ≤ 200 characters. This keeps the payload under FCM's 4 KB limit.
- **Reserved keys:** keys that FCM reserves (`from`, `notification`, `message_type`, `collapse_key`, `google.*`, `gcm.*`) get a `400`.
- **`USER` callers** get a `403`.

## Tests

- `contract/tests/user-devices.contract.test.ts`: the registry.
- `test/news/push-trigger.test.ts`: followers vs non-followers, drafts, rollback, pruning.
- `contract/tests/push-broadcast.contract.test.ts` and `test/push/push-broadcast.test.ts`: STAFF only, the delivered message.
- `test/push/FcmPushNotificationService.test.ts`: batching and pruning rules.
- `test/push/FirebasePushGateway.test.ts`: the real gateway against a fake `FirebaseMessaging` (no network).

The in-process tests inject `FakePushGateway` (`src/infra/push.ts`) to run the real FCM service against an in-memory gateway and wait for the background delivery with `pushIdle()`.
