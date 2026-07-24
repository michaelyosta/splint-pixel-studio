# Public Alpha Security Matrix

The public-alpha policy is a full account ban. A banned user receives
`403 {"error":"Account is banned","code":"ACCOUNT_BANNED"}` from every
authenticated route, including read-only routes. Moderator and admin roles do
not bypass a ban. `/health` is the only intentionally unauthenticated endpoint.

## Authenticated route coverage

| Area | Routes | Banned result | Regression coverage |
| --- | --- | --- | --- |
| Posts | `POST /posts/create`, `DELETE /posts/:id`, `POST /posts/:id/toggle-comments` | 403 | automated route matrix |
| Comments | `POST /posts/:id/comments`, `DELETE /comments/:id` | 403 | automated route matrix and route-contract tests |
| Reports | `POST /posts/:id/report`, `POST /comments/:id/report`, `POST /moderation/reports/create` | 403 | automated route matrix |
| Reactions | `POST/DELETE /posts/:id/like`, follow routes | 403 | centralized middleware and route matrix |
| Coloring/media | create, delete, catalog reads, progress reads/writes | 403 | automated route matrix |
| Profiles | own/public reads and settings updates | 403 | route matrix and repeated-auth test |
| Messaging | create, pay, reply, reject, inbox and outbox | 403 | centralized middleware |
| Meta | streaks, achievements, collections and analytics | 403 | centralized middleware |
| Moderation | reports, actions, hide, approve, ban and unban | 403 | banned-admin regression |

## Content exposure coverage

| Content state | Feed | Profile posts | Direct post | Comments | Public artworks | Moderation view |
| --- | --- | --- | --- | --- | --- | --- |
| active/public | visible | visible | visible | visible | visible when published | visible |
| hidden | excluded | excluded | 404 | 404 | excluded | visible to moderator |
| deleted | excluded | excluded | 404 | 404 | excluded | available only through retained moderation records |

There is currently no search endpoint. Collection template endpoints never
return posts or artworks and strip private media keys and raw storage fields.

## Database and production gates

- PostgreSQL enforces one report per `(reporter_id, target_type, target_id)`.
- Report target rows are locked while counting unique reporters.
- State changes and moderation audit records share one transaction.
- Migration rehearsal records before/after counts and verifies both artwork
  foreign keys in PostgreSQL.
- Production requires PostgreSQL, explicit S3 storage, exact HTTPS CORS origins,
  and explicit trusted proxy IPs/CIDRs. Numeric hop-count trust is rejected.
