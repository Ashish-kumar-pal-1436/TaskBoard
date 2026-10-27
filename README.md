# Taskboard

A full-stack Kanban project-management assignment built as an npm-workspaces
monorepo. It includes account authentication and project creation/list/detail
APIs, persisted project columns and cards, and server-backed card ordering.
Comments, activity history, and live updates remain future work.

## Requirements

- Node.js 24 LTS (Node.js 22.12 or newer is supported by the current Vite toolchain)
- npm 11
- MongoDB 7 or newer, running locally or available through a MongoDB URI

## Local setup

1. Install dependencies from the repository root:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env`, set `MONGODB_URI`, and replace the
   `JWT_SECRET` placeholder with a private random value of at least 32
   characters. The checked-in value is not a usable secret. Do not commit `.env`
   or share your secret.

3. Start MongoDB, then run both applications:

   ```sh
   npm run dev
   ```

   Vite's default development origin is `http://localhost:5173`, matching
   `CLIENT_ORIGIN` in `.env.example`; its `/api` proxy targets Express at
   `http://localhost:4000`. If port 5173 is occupied, Vite may choose another
   port, in which case update `CLIENT_ORIGIN` to match. The API refuses to
   start until MongoDB is available.

4. Open the frontend and register an account.

For separate frontend and backend deployments, set `CLIENT_ORIGIN` to the
frontend's exact origin (scheme, hostname, and port, with no path). Configure a
same-site reverse proxy for `/api` where possible so the browser can use the
HttpOnly authentication cookie reliably.

## Scripts

Run these commands from the repository root:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run Vite and the Express server together |
| `npm run lint` | Lint the workspace with ESLint |
| `npm run typecheck` | Type-check client and server |
| `npm test` | Run client and server tests |
| `npm run build` | Create the client and server production builds |
| `npm audit` | Check installed dependencies for known advisories |

## Current architecture

- `client/`: React 19, TypeScript, Vite, Tailwind CSS 4, and React Router.
- `server/`: Express 5 API, TypeScript, Mongoose models/repositories, Zod
  request and environment validation, and Vitest/Supertest tests.
- `server/src/features/auth/`: user persistence, auth validation, JWT session
  service, and authentication routes.
- `server/src/features/projects/`: persisted projects, embedded memberships,
  membership-filtered project access, columns, cards, and project validation.
- The frontend calls the API with same-origin `/api` paths. Vite proxies them
  in development; production should provide an equivalent reverse proxy.

## Authentication API

All responses use JSON. Errors have the shape
`{ "error": { "code": "...", "message": "..." } }`; validation errors can also
include a `details` array of field messages.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Validate input, create a user, and sign in |
| `POST` | `/api/auth/login` | Verify credentials and sign in |
| `GET` | `/api/auth/me` | Return the current public user |
| `POST` | `/api/auth/logout` | Revoke the current account's access tokens and sign out |
| `POST` | `/api/projects` | Create a project owned by the authenticated user |
| `GET` | `/api/projects` | List only projects the authenticated user belongs to |
| `GET` | `/api/projects/:projectId` | Retrieve project details if the user is a member |
| `POST` | `/api/projects/:projectId/members` | Add an existing registered user by email (owner only) |
| `GET` | `/api/projects/:projectId/columns` | List columns for a project member |
| `POST` | `/api/projects/:projectId/columns` | Add a column (owner only) |
| `PATCH` | `/api/projects/:projectId/columns/:columnId` | Rename a column (owner only) |
| `PATCH` | `/api/projects/:projectId/columns/reorder` | Reorder all columns (owner only) |
| `GET` | `/api/projects/:projectId/cards` | List cards for a project member |
| `POST` | `/api/projects/:projectId/cards` | Create a card in one of the project's columns |
| `PATCH` | `/api/projects/:projectId/cards/:cardId` | Update card fields |
| `DELETE` | `/api/projects/:projectId/cards/:cardId` | Delete a card |
| `PATCH` | `/api/projects/:projectId/cards/:cardId/move` | Move a card within or between columns |
| `GET` | `/api/health` | API liveness check |

Registration requires a valid email address, a display name of 2–60
characters, and a password of at least 12 characters. Passwords are hashed
with bcrypt (cost factor 12); bcrypt's 72-byte input limit is validated before
hashing. Email addresses are trimmed and stored lowercase with a unique
MongoDB index.

### Session and security decisions

- The API issues a short-lived (15-minute by default, configurable up to one
  hour) HS256 JWT in a `HttpOnly`, `SameSite=Lax` cookie scoped to `/api`.
  Production cookies set `Secure`; local HTTP development does not.
- The JWT is not returned in JSON or stored in browser `localStorage` or
  `sessionStorage`. This reduces exposure to JavaScript token theft. As with
  any cookie-based session, same-origin scripting remains a risk; keep the
  frontend dependencies trusted and use HTTPS in production.
- The server checks the JWT signature, expiry, user ID, and token version and
  loads the account on each protected request. Logout increments the user's
  token version, invalidating all of that user's outstanding tokens (including
  other signed-in devices).
- CORS allows only the configured `CLIENT_ORIGIN`; authentication mutations
  also reject a mismatched `Origin` header. The API uses Helmet, JSON body
  size limits, a general API rate limit, and a stricter shared login/register
  rate limit.
- Password hashes and token-version fields are excluded from normal user
  queries and public responses. API errors do not return stack traces.
- MongoDB connection attempts have a bounded timeout. Startup fails safely if
  the database is unavailable; SIGINT/SIGTERM close the HTTP server and
  database connection.

## Projects and memberships

Each project document stores its name, owner user ID, timestamps, and an
embedded `members` array of user IDs and roles (`owner` or `member`), plus
embedded columns with names and integer positions, and embedded cards. New projects receive `To Do`,
`In Progress`, and `Done` columns in the same document write, so defaults
cannot be partially created. The
owner is recorded both as `ownerId` and as the single owner membership; keeping
the membership in the project document makes project creation and initial
owner membership atomic without requiring a multi-document transaction. A
multikey index on `members.userId` supports member-only project listing.

Project creation derives the owner solely from the authenticated cookie; the
request accepts only a validated project name and rejects extra fields such as
client-supplied owner or role. All project routes require authentication.
Project listing queries memberships, and project detail checks membership on
the server and returns the same not-found response for nonexistent projects
and projects the user cannot access, avoiding ID-based disclosure. Responses
include the requesting user's role, not the full member list.

Only a project owner may add an existing registered user with
`POST /api/projects/:projectId/members` and a JSON body containing an email.
The acting user is taken from the authenticated session; the endpoint does not
accept a member ID or role. Unknown users and inaccessible projects return
not-found errors, while an existing membership (including the owner) returns a
conflict. Adding a membership updates the project document atomically.

Project members can list columns. Only the owner can add, rename, or reorder
them. Column IDs are scoped to their project; a column from another project
cannot be renamed through a guessed or mismatched ID. Reorder requests must
contain every current column ID exactly once, and the ordering update is
performed atomically on the project document.

Cards are embedded in their project document and reference an embedded column
ID. Each card stores a required trimmed title (1–120 characters), optional
description (up to 2,000 characters), optional project-member assignee, due
date, up to 8 labels (each up to 24 characters), numeric column position, and
timestamps. Every card operation requires authentication and project
membership. The server verifies that the target card and destination column
belong to the requested project; assignees must already be members. Clients
cannot choose a card position.

Card positions are fractional numbers. Appending allocates a position after
the current last card in that column; a move between neighbors uses their
midpoint, so ordinary moves update one card rather than rewriting the board.
Moves compare-and-set the project's version to reject a stale concurrent
ordering update. If floating-point precision is exhausted between adjacent
positions, the API returns `POSITION_PRECISION_EXHAUSTED`; automatic rebalancing
is not implemented yet. The workspace supports mouse drag-and-drop and
up/down move buttons. Failed moves leave the last confirmed board state intact.

Card API request examples:

```http
POST /api/projects/:projectId/cards
Content-Type: application/json
Cookie: taskboard_access=<HttpOnly session cookie>

{"columnId":"<project-column-id>","title":"Ship the first version","description":"Prepare the launch","labels":["Planning"],"dueDate":"2027-01-15T00:00:00.000Z"}
```

```http
PATCH /api/projects/:projectId/cards/:cardId/move
Content-Type: application/json
Cookie: taskboard_access=<HttpOnly session cookie>

{"columnId":"<destination-column-id>","beforeCardId":"<optional-card-id>"}
```

Example request:

```http
POST /api/projects
Content-Type: application/json
Cookie: taskboard_access=<HttpOnly session cookie>

{"name":"Website refresh"}
```

## Testing

`npm test` runs client and backend suites. The backend auth, project, card, and
health endpoint tests use isolated in-memory repositories; they exercise real bcrypt
hashing, signed JWT cookies, authentication middleware, logout invalidation,
project membership filtering, and API responses without a production or local
MongoDB server. They do not test MongoDB server behavior or the Mongoose
adapters against a live database.

## Milestone status and limitations

Implemented: responsive application/authentication screens, registration,
login, protected workspace route, session check, logout, user model, server
validation, cookie-based access tokens, API security middleware, database
connection lifecycle, project creation/list/detail APIs, owner-only member
addition, default project columns, persistent column management and cards,
fractional card ordering, and server-side project membership checks. The
frontend loads persisted columns and cards, supports project/card creation,
editing and deletion, column creation/reordering, and card drag-and-drop.

Not implemented yet: member removal/invitations, comments, activity, filters,
and seed/demo data.

## AI-tool usage

An AI coding assistant was used to scaffold and implement the assignment in
milestones, inspect existing files, and run the project's lint, type-check,
test, build, and dependency-audit commands. Generated changes and test results
were reviewed in the workspace; no external repository, video, or deployment
is claimed here.

## Future improvements

- Add member invitation/removal and role management.
- Add integration tests against a disposable MongoDB instance, including
  unique-index and transaction behavior.
- Add CSRF tokens if the deployment topology requires cross-site cookies.
- Add account recovery, email verification, and refresh-session management
  before using the application with real user accounts.
