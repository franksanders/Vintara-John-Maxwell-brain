# 0002: Shared Container Image for Development and Testing

- Status: Accepted
- Date: 2026-06-28
- Supersedes: None

## Context

ADR 0001 establishes that the canonical development environment is containerized. Development, build, and test commands still need a consistent implementation pattern so contributors do not accidentally create divergent runtime environments.

Using one container definition for the application and a separate ad hoc container for tests can hide dependency, operating system, or runtime differences. Running package managers on the host can also create local dependency directories and generated artifacts that do not match the container environment.

## Decision

Development, build, and test workflows must use the project container image or a named build stage from the project Dockerfile.

Compose services may provide separate commands for app development, tests, builds, or checks, but those services should reuse the same project image or build context instead of defining unrelated runtime environments.

Tests should be invoked as a container command variant, such as a Compose `test` service or an overridden command on the app service.

Project-specific package installation, build, and test commands should run inside containers.

Host source files may be mounted into development and test containers, but dependency directories and generated runtime artifacts should stay in container-managed storage, named volumes, or ephemeral container filesystems.

## Consequences

Development and test behavior stays closer to the environment used by the running application.

Contributors avoid installing project-specific runtimes or dependencies on the host for normal work.

Compose files may include multiple services for convenience, but those services must not drift into separate runtime definitions.

Container definitions need enough structure, such as named Dockerfile stages, to support both interactive development and production image builds.

## Implementation Notes

Prefer Dockerfile stages such as `dev`, `build`, and `runtime` when a project needs different dependency sets.

Use Compose services to select commands, profiles, ports, and mounts, not to define unrelated runtimes.

Keep `node_modules`, Python virtual environments, build output, caches, and similar generated artifacts out of host-mounted source directories unless an accepted ADR explicitly approves an exception.

When tests need source access, mount only the files and directories required for the test command where practical.

If a container engine requires a compatibility workaround, document the command without changing the canonical Compose model.
