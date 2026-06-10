# NestJS Microservices — Auth & Profile

A production-style monorepo demonstrating how to split a backend into independent **NestJS microservices** that communicate over **gRPC**, sit behind an **API Gateway**, and share infrastructure like **Redis** and **PostgreSQL** — all wired together with **Docker Compose**.

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white" alt="pnpm" />
  <img src="https://img.shields.io/badge/gRPC-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="gRPC" />
  <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Drizzle_ORM-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black" alt="Drizzle ORM" />
  <img src="https://img.shields.io/badge/Neon-00E599?style=for-the-badge&logo=neon&logoColor=black" alt="Neon" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white" alt="JWT" />
</p>

---

## Table of Contents

- [What this project is about](#what-this-project-is-about)
- [Architecture overview](#architecture-overview)
- [Project structure](#project-structure)
- [Services in depth](#services-in-depth)
  - [API Gateway](#1-api-gateway-port-3000)
  - [Auth Service](#2-auth-service-port-3001--grpc-5001)
  - [Profile Service](#3-profile-service-port-3002)
- [How gRPC works here](#how-grpc-works-here)
- [How JWT authentication flows](#how-jwt-authentication-flows)
- [Rate limiting with Redis](#rate-limiting-with-redis)
- [Circuit breaker](#circuit-breaker)
- [Database — Drizzle ORM + Neon](#database--drizzle-orm--neon)
- [Docker & Docker Compose](#docker--docker-compose)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Tech stack](#tech-stack)

---

## What this project is about

Most tutorials show a single NestJS app that does everything. In the real world, teams split concerns into **separate services** that can be developed, deployed, and scaled independently.

This project demonstrates that split:

| Responsibility                           | Service               |
| ---------------------------------------- | --------------------- |
| Routing all incoming traffic             | API Gateway           |
| User registration, login, token issuance | Auth Service          |
| User profile storage and retrieval       | Profile Service       |
| Fast inter-service token validation      | gRPC (Auth ↔ Profile) |
| Rate limiting across restarts            | Redis                 |

---

## Architecture overview

```
                        ┌─────────────────────────────────────────────┐
                        │               CLIENT (browser / app)        │
                        └─────────────────────┬───────────────────────┘
                                              │ HTTP
                                              ▼
                        ┌─────────────────────────────────────────────┐
                        │              API GATEWAY  :3000             │
                        │                                             │
                        │  • JWT validation (local, fast)             │
                        │  • Rate limiting  (Redis-backed)            │
                        │  • HTTP proxy  →  downstream services       │
                        └────────────┬───────────────────┬────────────┘
                                     │ HTTP proxy        │ HTTP proxy
                          ┌──────────▼──────┐    ┌───────▼──────────┐
                          │  AUTH SERVICE   │    │ PROFILE SERVICE  │
                          │    :3001        │    │    :3002         │
                          │                 │    │                  │
                          │ • Register      │    │ • GET  /profile  │
                          │ • Login         │◄───│ • PATCH /profile │
                          │ • ValidateToken │gRPC│                  │
                          │   (gRPC :5001)  │    │ Circuit Breaker  │
                          └────────┬────────┘    └───────┬──────────┘
                                   │                     │
                          ┌────────▼────────┐    ┌───────▼──────────┐
                          │  Neon Postgres  │    │  Neon Postgres   │
                          │  (users table)  │    │ (profiles table) │
                          └─────────────────┘    └──────────────────┘
                                        ┌──────────────┐
                                        │    Redis     │
                                        │  rate limit  │
                                        └──────────────┘
```

**Key design decisions:**

- **API Gateway** is the single entry point. Clients never talk to Auth or Profile directly.
- **Profile Service** does not trust the gateway's JWT validation — it calls Auth Service over gRPC to independently verify every token.
- **Redis** stores rate-limit counters so they survive gateway restarts and work correctly if you run multiple gateway instances.

---

## Project structure

```
auth-profile/                        ← monorepo root (pnpm workspaces)
├── apps/
│   ├── api-gateway/                 ← Express HTTP proxy + JWT + throttling
│   │   └── src/
│   │       ├── auth/guards/         ← local JWT guard
│   │       └── gateway/             ← proxy controller
│   ├── auth-service/                ← registration, login, gRPC token validation
│   │   └── src/
│   │       ├── dto/                 ← register / login DTOs
│   │       ├── db/                  ← Drizzle schema + client (users)
│   │       └── guards/              ← JWT guard for HTTP routes
│   └── profile-service/             ← profile CRUD + gRPC auth client
│       └── src/
│           ├── clients/             ← gRPC client for auth-service
│           ├── common/              ← circuit breaker
│           ├── auth/guards/         ← guard that calls auth-service via gRPC
│           ├── db/                  ← Drizzle schema + client (profiles)
│           └── profile/             ← controller, service, DTO
├── libs/
│   └── shared/
│       └── src/proto/auth.proto     ← single source of truth for the gRPC contract
├── docker-compose.yaml              ← spins up Redis
└── pnpm-workspace.yaml
```

---

## Services in depth

### 1. API Gateway (port 3000)

The gateway is the **only service exposed to the outside world**. It has two jobs:

**Job 1 — Validate the JWT before forwarding the request.**

```
Client request
  │
  ▼
ThrottlerGuard  →  check Redis: has this IP exceeded 100 req/min?
  │
  ▼
JwtGuard  →  verify the JWT signature locally (no network call needed)
  │
  ▼
proxy()  →  forward the full request to the correct downstream service
```

The gateway validates the token _locally_ using the shared `JWT_SECRET`. This is fast — no extra network hop. It then forwards the original request (including the `Authorization` header) so downstream services can also read the user's identity.

**Job 2 — Route and proxy requests.**

| Incoming route            | Proxied to                            |
| ------------------------- | ------------------------------------- |
| `POST /api/auth/register` | Auth Service (public — no JWT needed) |
| `POST /api/auth/login`    | Auth Service (public)                 |
| `GET  /api/auth/me`       | Auth Service (JWT required)           |
| `GET  /api/profile`       | Profile Service (JWT required)        |
| `PATCH /api/profile`      | Profile Service (JWT required)        |

---

### 2. Auth Service (port 3001 / gRPC 5001)

The auth service owns **everything related to users and tokens**. It exposes two interfaces:

**HTTP** (via the gateway proxy):

| Method | Route                | Description                       |
| ------ | -------------------- | --------------------------------- |
| POST   | `/api/auth/register` | Creates a new user, returns JWT   |
| POST   | `/api/auth/login`    | Verifies credentials, returns JWT |
| GET    | `/api/auth/me`       | Returns the decoded token payload |

**gRPC** (internal, called by Profile Service):

```protobuf
// libs/shared/src/proto/auth.proto
service AuthService {
  rpc ValidateToken (ValidateTokenRequest) returns (ValidateTokenResponse);
}
```

Profile Service calls `ValidateToken` on every request to independently verify the token — it does not trust that the gateway already validated it.

**Password storage** uses `bcrypt` with 10 salt rounds. Passwords are never returned in any response.

**Token generation** uses `@nestjs/jwt`. The payload stored in the token is:

```json
{ "sub": "<userId>", "email": "user@example.com" }
```

---

### 3. Profile Service (port 3002)

The profile service is fully isolated — it has its own database and does not share code with the auth service.

**Authentication** is handled by `GrpcAuthGuard`, which calls `AuthClient.validateToken()` on every request:

```
Incoming request
  │
  ▼
GrpcAuthGuard
  │  reads Authorization header
  │  calls auth-service via gRPC: ValidateToken(token)
  │  attaches { userId, email } to request.user
  ▼
ProfileController
  │  reads user from request
  ▼
ProfileService  →  upsert in Neon Postgres
```

Profiles are **auto-created** on first access using an atomic upsert — there is no separate "create profile" endpoint.

---

## How gRPC works here

### What is gRPC?

gRPC is a high-performance Remote Procedure Call framework. Instead of defining REST endpoints, you define **a contract** (in a `.proto` file) that both the server and the client use to generate type-safe code.

Think of it as: instead of `fetch('/api/validate-token', { body: token })`, you call `authService.validateToken({ token })` as if it were a local function — but it runs on another server.

### The contract

```protobuf
// libs/shared/src/proto/auth.proto  ← both services read this same file

service AuthService {
  rpc ValidateToken (ValidateTokenRequest) returns (ValidateTokenResponse);
}

message ValidateTokenRequest {
  string token = 1;       // the JWT string to validate
}

message ValidateTokenResponse {
  bool   valid  = 1;      // was the token valid?
  string userId = 2;      // decoded user ID
  string email  = 3;      // decoded email
  string error  = 4;      // error message if invalid
}
```

### Server side — Auth Service

NestJS registers the gRPC server in `main.ts`:

```typescript
app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.GRPC,
  options: {
    package: "auth",
    protoPath: join(__dirname, "../../../libs/shared/src/proto/auth.proto"),
    url: `0.0.0.0:${process.env.GRPC_PORT ?? 5001}`,
  },
});
```

The handler is a regular controller method annotated with `@GrpcMethod`:

```typescript
@GrpcMethod('AuthService', 'ValidateToken')
async validateToken({ token }: { token: string }) {
  return this.authService.validateToken(token);
}
```

### Client side — Profile Service

Profile Service connects to Auth Service using the `@Client` decorator:

```typescript
@Client({
  transport: Transport.GRPC,
  options: {
    package: 'auth',
    protoPath: join(__dirname, '../../../../libs/shared/src/proto/auth.proto'),
    url: process.env.AUTH_SERVICE_GRPC_URL || 'localhost:5001',
  },
})
private client: ClientGrpc;
```

And calls it like a regular async function:

```typescript
const result = await firstValueFrom(this.authService.validateToken({ token }));
```

### Why gRPC instead of HTTP for this call?

|             | HTTP/REST   | gRPC                              |
| ----------- | ----------- | --------------------------------- |
| Protocol    | Text (JSON) | Binary (Protocol Buffers)         |
| Schema      | Optional    | Required (`.proto`)               |
| Type safety | Manual      | Generated                         |
| Performance | Good        | Better (smaller payloads, HTTP/2) |
| Best for    | Public APIs | Internal service-to-service       |

For a hot path like "validate token on every request", the lower latency and binary encoding of gRPC make a real difference at scale.

---

## How JWT authentication flows

Here is the complete flow for a protected request (`GET /api/profile`):

```
1. Client sends:
   GET /api/profile
   Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

2. API Gateway — JwtGuard
   • Reads the Authorization header
   • Calls jwtService.verifyAsync(token, { secret: JWT_SECRET })
   • If invalid → 401 Unauthorized (no network call made)
   • If valid  → attaches payload to request, forwards to profile-service

3. Profile Service — GrpcAuthGuard
   • Reads the Authorization header (forwarded by the gateway)
   • Calls auth-service via gRPC: ValidateToken({ token })
   • Auth service verifies the signature again (defense in depth)
   • If invalid → 401 Unauthorized
   • If valid  → attaches { userId, email } to request.user

4. ProfileController
   • Reads request.user.userId
   • Calls profileService.getProfile(userId)
   • Returns the profile JSON
```

Both the gateway and the profile service verify the token — this is intentional. If someone bypasses the gateway and hits the profile service directly, the gRPC guard still protects it.

---

## Rate limiting with Redis

The gateway uses `@nestjs/throttler` to limit how many requests a single IP can make.

### Why Redis?

Without Redis, rate-limit counters are stored in memory. That means:

- Counters reset every time the gateway restarts
- If you run two gateway instances, each has its own counter — a user could make 2× the allowed requests

With Redis, all instances share the same counters and they persist across restarts.

### Configuration

```typescript
// apps/api-gateway/src/app.module.ts
ThrottlerModule.forRoot({
  throttlers: [{ ttl: seconds(60), limit: 100 }],
  storage: new ThrottlerStorageRedisService(
    new Redis(process.env.REDIS_URL),
  ),
}),
```

### Docker Compose starts Redis

```yaml
# docker-compose.yaml
services:
  redis:
    image: redis:latest
    ports:
      - "6379:6379"
```

Run `docker compose up -d` before starting the gateway.

---

## Circuit breaker

The profile service makes a gRPC call to auth-service on **every single request**. If auth-service goes down, without protection every profile request would wait for a timeout before failing — creating a cascade of slow failures.

The circuit breaker (`src/common/circuit-breaker.ts`) prevents this:

```
State: CLOSED (normal)
  Every gRPC call goes through normally.
  On failure → increment counter.
  5 failures → trip to OPEN.

State: OPEN (auth-service is down)
  All calls are rejected immediately with 503 Service Unavailable.
  No network calls made — fail fast.
  After 30 seconds → move to HALF_OPEN.

State: HALF_OPEN (testing recovery)
  One probe call is allowed through.
  Success → reset to CLOSED.
  Failure → back to OPEN.
```

Importantly, **invalid tokens do not trip the breaker** — only real infrastructure failures (network timeouts, connection refused) do. A burst of bad tokens from a client won't open the circuit.

---

## Database — Drizzle ORM + Neon

Both services use [Drizzle ORM](https://orm.drizzle.team/) with [Neon](https://neon.tech/) serverless PostgreSQL.

**Auth Service schema:**

```typescript
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(), // bcrypt hash
  createdAt: timestamp("created_at").defaultNow(),
});
```

**Profile Service schema:**

```typescript
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().unique(), // references auth.users.id
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  bio: text("bio").notNull().default(""),
  avatarUrl: text("avatar_url").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdateFn(() => new Date()),
});
```

The profile is created **atomically on first access** using an upsert:

```typescript
const [profile] = await db
  .insert(profiles)
  .values({ userId })
  .onConflictDoUpdate({ target: profiles.userId, set: { userId } })
  .returning();
```

This avoids a race condition — if two requests arrive simultaneously for a new user, only one INSERT wins and both get the same row back.

**Run migrations:**

```bash
# from each service directory
pnpm db:generate   # generate migration files from schema
pnpm db:migrate    # apply migrations to Neon
```

---

## Docker & Docker Compose

The `docker-compose.yaml` at the project root starts Redis:

```yaml
services:
  redis:
    image: redis:latest
    container_name: redis
    ports:
      - "6379:6379"
```

**Start Redis:**

```bash
docker compose up -d
```

**Stop Redis:**

```bash
docker compose down
```

The three NestJS services are run locally (see [Getting started](#getting-started)). A full Docker setup for all services would add a `Dockerfile` per service and add them to the compose file — a natural next step for production.

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 8+ (`npm install -g pnpm`)
- [Docker](https://www.docker.com/) (for Redis)
- A [Neon](https://neon.tech/) account (free tier is enough) — or any PostgreSQL instance

### 1. Clone and install

```bash
git clone https://github.com/dimermichel/nestjs-auth-profile
cd auth-profile
pnpm install
```

### 2. Set up environment variables

Each service has its own `.env` file. Create them from the table below:

```bash
# apps/api-gateway/.env
JWT_SECRET=change-me-to-a-strong-random-secret
REDIS_URL=redis://localhost:6379
AUTH_SERVICE_URL=http://localhost:3001
PROFILE_SERVICE_URL=http://localhost:3002
PORT=3000

# apps/auth-service/.env
DATABASE_URL=postgresql://<user>:<password>@<host>/neondb?sslmode=require
JWT_SECRET=change-me-to-a-strong-random-secret
PORT=3001
GRPC_PORT=5001

# apps/profile-service/.env
DATABASE_URL=postgresql://<user>:<password>@<host>/neondb?sslmode=require
AUTH_SERVICE_GRPC_URL=localhost:5001
PORT=3002
```

> `JWT_SECRET` must be **identical** in the gateway and auth-service.

### 3. Start Redis

```bash
docker compose up -d
```

### 4. Run database migrations

```bash
cd apps/auth-service    && pnpm db:migrate && cd ../..
cd apps/profile-service && pnpm db:migrate && cd ../..
```

### 5. Start all three services

Open three terminal tabs:

```bash
# Terminal 1 — Auth Service (HTTP :3001 + gRPC :5001)
pnpm --filter auth-service start:dev

# Terminal 2 — Profile Service (:3002)
pnpm --filter profile-service start:dev

# Terminal 3 — API Gateway (:3000)
pnpm --filter api-gateway start:dev
```

All traffic goes through **port 3000**.

---

## Environment variables

### API Gateway (`apps/api-gateway/.env`)

| Variable              | Example                  | Description                          |
| --------------------- | ------------------------ | ------------------------------------ |
| `JWT_SECRET`          | `a-long-random-string`   | Must match the value in auth-service |
| `REDIS_URL`           | `redis://localhost:6379` | Redis connection string              |
| `AUTH_SERVICE_URL`    | `http://localhost:3001`  | HTTP base URL of auth-service        |
| `PROFILE_SERVICE_URL` | `http://localhost:3002`  | HTTP base URL of profile-service     |
| `PORT`                | `3000`                   | Port the gateway listens on          |

### Auth Service (`apps/auth-service/.env`)

| Variable       | Example                | Description                              |
| -------------- | ---------------------- | ---------------------------------------- |
| `DATABASE_URL` | `postgresql://...`     | Neon (or any Postgres) connection string |
| `JWT_SECRET`   | `a-long-random-string` | Secret used to sign and verify JWTs      |
| `PORT`         | `3001`                 | HTTP port                                |
| `GRPC_PORT`    | `5001`                 | gRPC port                                |

### Profile Service (`apps/profile-service/.env`)

| Variable                | Example            | Description                              |
| ----------------------- | ------------------ | ---------------------------------------- |
| `DATABASE_URL`          | `postgresql://...` | Neon (or any Postgres) connection string |
| `AUTH_SERVICE_GRPC_URL` | `localhost:5001`   | gRPC address of auth-service             |
| `PORT`                  | `3002`             | HTTP port                                |

---

## API reference

All requests go through the **API Gateway on port 3000**.

### Auth

#### Register

```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secret-password"
}
```

```json
{
  "user": { "id": "uuid", "email": "user@example.com", "createdAt": "..." },
  "token": "eyJhbGci..."
}
```

#### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secret-password"
}
```

```json
{
  "user": { "id": "uuid", "email": "user@example.com", "createdAt": "..." },
  "token": "eyJhbGci..."
}
```

#### Get current user

```http
GET /api/auth/me
Authorization: Bearer <token>
```

```json
{
  "sub": "uuid",
  "email": "user@example.com",
  "iat": 1234567890,
  "exp": 1234567890
}
```

### Profile

#### Get profile

```http
GET /api/profile
Authorization: Bearer <token>
```

```json
{
  "id": "uuid",
  "userId": "uuid",
  "firstName": "",
  "lastName": "",
  "bio": "",
  "avatarUrl": "",
  "createdAt": "...",
  "updatedAt": "..."
}
```

Profile is auto-created on first fetch — no separate creation step needed.

#### Update profile

```http
PATCH /api/profile
Authorization: Bearer <token>
Content-Type: application/json

{
  "firstName": "Ada",
  "lastName":  "Lovelace",
  "bio":       "First programmer.",
  "avatarUrl": "https://example.com/avatar.png"
}
```

All fields are optional. Returns the updated profile.

---

## Tech stack

| Technology                                                           | Role                                         |
| -------------------------------------------------------------------- | -------------------------------------------- |
| [NestJS](https://nestjs.com/)                                        | Framework for all three services             |
| [gRPC](https://grpc.io/) + [Protocol Buffers](https://protobuf.dev/) | Inter-service communication (Profile → Auth) |
| [Redis](https://redis.io/)                                           | Rate-limit counter storage                   |
| [Docker Compose](https://docs.docker.com/compose/)                   | Local Redis setup                            |
| [Drizzle ORM](https://orm.drizzle.team/)                             | Type-safe database queries                   |
| [Neon](https://neon.tech/)                                           | Serverless PostgreSQL                        |
| [pnpm workspaces](https://pnpm.io/workspaces)                        | Monorepo package management                  |
| [axios](https://axios-http.com/)                                     | HTTP proxying in the gateway                 |
| [bcrypt](https://github.com/kelektiv/node.bcrypt.js)                 | Password hashing                             |
| [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken)           | JWT signing and verification                 |

---

<div align="center">

**⭐ If this project was useful, consider leaving a star!**

_Built with dedication for learning NestJS_ 🚀

</div>
