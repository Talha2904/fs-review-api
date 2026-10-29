# 0010. Front end and backend are separate repositories

Date: 2026-10-28 · Status: Accepted

## Context

The owner wants the backend independent and deployable on its own, and has decided that the web front end
(`react-app`) and the backend (`api`) will be two git repositories. Some rules (roles and permissions, file
rules, the check library, billing arithmetic) are needed by both sides and must not be duplicated.

## Decision

- Two repositories: `react-app` (web) and `api` (backend). On a developer machine they sit as siblings under
  a plain parent folder, `fs-review`, which is not a repository and holds no tooling.
- `shared` is an npm workspace inside the api repository, published as the versioned package
  `@fs-review/shared` to GitHub Packages by the api's release workflow. The front end depends on a pinned
  version. The api is the enforcing side of every shared rule, so the api repo owns the source.
- No cross-repository relative imports. The old `server/` imports of `../src/lib/*` end when it is removed.
- The HTTP contract between the repos is the OpenAPI document the api generates; the front end's API client
  is checked against it in the front end's CI.

## Consequences

- Each repo has its own CI, versioning and deployment.
- A change to a shared rule is one pull request in the api repo and one dependency bump in the front end.
- Until `@fs-review/shared` publishes its first version (Phase 2), the front end keeps its existing copies
  of the rules under `src/lib` and `src/data`.
