# Contributing to calmly-sync-server

Thank you for taking the time to contribute.

## Dev setup

```bash
# Prerequisites: Node 20+, pnpm 9+, Docker (for integration tests)
git clone https://github.com/your-org/calmly
cd calmly
pnpm install

# Run the server in watch mode against a local Postgres
docker compose up -d postgres
pnpm --filter @calmly/server dev
```

## Running tests

```bash
pnpm --filter @calmly/server test        # unit + integration (requires Docker)
pnpm --filter @calmly/server typecheck   # TypeScript
```

Integration tests spin up a throwaway Postgres via testcontainers — Docker must be running.

## Making changes

1. Fork and create a branch: `git checkout -b feat/my-change`
2. Write tests for any new behaviour
3. Run `pnpm --filter @calmly/server test` and `typecheck` — both must pass
4. Open a PR against `main`

## PR process

- Keep PRs focused; one logical change per PR
- Describe the _why_ in the PR body, not just the _what_
- The maintainers aim to review within 5 business days

## Issue labels

| Label              | Meaning                             |
| ------------------ | ----------------------------------- |
| `bug`              | Confirmed defect                    |
| `enhancement`      | New feature or improvement          |
| `question`         | Needs clarification                 |
| `good first issue` | Suitable for new contributors       |
| `self-host`        | Specific to self-hosted deployments |

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
