# Estro

Estro is a local-first browser photo and video editor designed for direct, collaborative, teaching, and autonomous WebMCP workflows.

Phases 1 and 2 are complete and user-verified. Together they establish the local project and transaction foundation plus an empty image document, persistent editor shell, canvas navigation, contextual panels, keyboard and pointer input, guides and overlays, semantic selection/focus, command search, and 15 top-level Site tools using the same non-destructive state paths.

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
docker build -t estro:phase-2 .
docker run --rm -p 8080:8080 estro:phase-2
```

The agent creates and reviews container files but does not run Docker commands without explicit user direction.
