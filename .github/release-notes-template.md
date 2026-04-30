# calmly-sync ${version}

## What's changed

<!-- Paste the relevant section from server/CHANGELOG.md -->

## Docker

```bash
docker pull ghcr.io/your-org/calmly-sync:${version}
```

## Verify the image digest

```bash
# SHA256 digest is attached as checksums-${version}.txt to this release
grep ghcr.io checksums-${version}.txt
```

## Upgrade

```bash
docker compose pull sync
docker compose up -d sync
```

Migrations run automatically on startup.

See [docs/SELF_HOSTING.md](https://github.com/your-org/calmly/blob/main/docs/SELF_HOSTING.md) for the full self-hosting guide.
