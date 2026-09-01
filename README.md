# Estro

Estro is a local-first browser photo and video editor designed for direct, collaborative, teaching, and autonomous WebMCP workflows.

Phase 1 is complete and user-verified. Its six slices establish the containerized React/TypeScript application, local project lifecycle, immutable revisions, append-only transactions, Undo/Redo, provenance, shared autosave and interrupted-session recovery, named snapshots, seven top-level Site tools, UI/WebMCP parity, visible permission gates, structured errors, and atomic dry-run proposals.

## Development environment

Dependencies stay inside the Compose-managed `estro_node_modules` volume. The first install must be run by the project owner:

```sh
docker compose run --rm app npm install
docker compose up --build
```

Open `http://localhost:5173`.

Run verification inside the same isolated environment:

```sh
docker compose run --rm app npm run typecheck
docker compose run --rm app npm run test:run
docker compose run --rm app npm run build
```

The production image uses the generated `package-lock.json`:

```sh
docker build -t estro:phase-1 .
docker run --rm -p 8080:8080 estro:phase-1
```

The agent creates and reviews container files but does not run Docker commands without explicit user direction.
