# Local Container Verification Handoff

This note captures the current local verification state for the `containerize-app` branch.

## Repository State

- Worktree: `/Users/franksanders/Projects/vintara/Vintara-John-Maxwell-brain-containerize`
- Branch: `containerize-app`
- Local commit: `5fcaa1b Add containerized development workflow`
- Push/PR status: not pushed; no PR opened yet.

The branch adds:

- ADR governance files.
- ADR 0001 for containerized development.
- ADR 0002 for shared container image usage across dev/test workflows.
- `Dockerfile` with `base`, `dev`, `build`, and `runtime` stages.
- `docker-compose.yml` with:
  - `app` using the Dockerfile `dev` stage.
  - `test` using the same Dockerfile `dev` stage under the `tools` profile.
  - `app-prod` using the production image under the `prod` profile.
  - `qdrant` as the supporting vector store.

## Verification Completed

- `podman compose ... config` succeeded earlier for the Compose file.
- A previous containerized test run succeeded before the final Compose refactor:
  - `npm run build` passed.
  - `npm test` passed.
  - 4 test suites passed, 7 tests passed.
- After the final refactor, runtime verification was not completed due to Podman machine instability.

## Podman Context

The local machine uses Podman `5.8.2` on macOS with the `applehv` VM provider.

Observed failure modes:

- `podman machine start` reports success, but later commands can fail with stale socket errors.
- Rootless storage errors occurred before recreating the machine:
  - `readlink /var/home/core/.local/share/containers/storage/overlay: invalid argument`
- Rootful mode was tried briefly but was intentionally reverted because rootless had worked before and is preferred.

## Last Attempt

The default Podman VM was removed and recreated rootless:

```sh
podman machine rm -f podman-machine-default
podman machine init podman-machine-default
podman machine start podman-machine-default
```

Rootless status was confirmed:

```sh
podman info --format '{{.Host.Security.Rootless}}'
# true
```

The next verification attempt was to start the lightest real project container first:

```sh
podman machine start podman-machine-default && \
podman compose up -d qdrant && \
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  curl -fsS http://localhost:6333/ && exit 0
  sleep 1
done
podman ps -a --format '{{.Names}} {{.Status}} {{.Ports}}'
exit 1
```

That attempt hung at `podman machine start podman-machine-default`; Compose never began. The stuck process was terminated.

## Recommended Restart Point

Start by checking the fresh rootless Podman machine, not by changing repository files:

```sh
podman machine list
podman machine start podman-machine-default
podman info
podman system connection list
```

If the machine starts cleanly, verify one real service at a time:

```sh
podman compose up -d qdrant
curl http://localhost:6333/
```

Then bring up the app:

```sh
podman compose up --build app
curl http://localhost:3000/health
curl http://localhost:3000/
```

Then verify the shared-image test workflow:

```sh
podman compose --profile tools run --rm test
```

Only push `containerize-app` and open the PR after local app health/UI and containerized tests pass.
