# 0001: Containerized Development Environment

- Status: Accepted
- Date: 2026-06-28

## Context

The project needs a repeatable local development environment that works across contributors and minimizes drift between machines. Contributors may use different host operating systems and container engines, including Docker and Podman.

Project-specific runtimes, services, and dependencies can create inconsistent local setups when installed directly on the host. A containerized environment provides a shared baseline for the application runtime and supporting services while allowing source code to remain editable on the host.

## Decision

The canonical development environment is containerized.

Docker Compose defines the canonical local development environment. Other Compose-compatible tools, such as Podman Compose, may be used when they can run the same Compose definition.

Source code remains on the host and is mounted into containers for normal development.

Developers should not be required to install project-specific runtimes on the host unless a future accepted ADR explicitly approves that requirement.

Normal development should rely on mounted volumes and hot reload where practical.

Container rebuilds should generally only be required when infrastructure, runtime, or dependency definitions change.

## Consequences

Contributors get a more consistent development environment with fewer host-specific setup requirements.

The Compose definition becomes the primary source of truth for local application services, ports, volumes, and runtime configuration.

Local workflows should prefer commands that run inside containers when they depend on project-specific runtimes or services.

Development container definitions must stay current when dependencies, runtime versions, or supporting services change.

There may still be limited host prerequisites for general tooling, such as a container engine, Git, or repository management tools.

## Implementation Notes

Use Docker Compose files to define the local application stack and supporting services.

Prefer bind mounts for source code during development so code edits on the host are reflected inside containers.

Use named volumes for service data, dependency caches, and other generated state that should persist across container restarts.

Use hot reload where the application framework supports it cleanly.

Avoid requiring host-level installation of project runtimes such as Node.js, Python, database servers, or vector stores for normal development.

Document any approved exception in a future ADR.
