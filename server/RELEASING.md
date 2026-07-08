# Release checklist for calmly-sync-server

## Before tagging

1. **Update `server/CHANGELOG.md`**

   - Move bullets from `[Unreleased]` to a new versioned section: `## [X.Y.Z] — YYYY-MM-DD`
   - Leave an empty `## [Unreleased]` section at the top for the next cycle

2. **Bump version in `server/package.json`**

   ```bash
   # Edit "version": "X.Y.Z"
   ```

3. **Commit the release prep**

   ```bash
   git add server/package.json server/CHANGELOG.md
   git commit -m "chore(release): sync-server X.Y.Z"
   ```

4. **Tag the commit**
   ```bash
   git tag sync-vX.Y.Z
   git push origin sync-vX.Y.Z
   ```

## After tagging

5. **Watch the release workflow** at `.github/workflows/release.yml`

   - Build & push job publishes `ghcr.io/your-org/calmly-sync:X.Y.Z` and `:latest`
   - Smoke-test job pulls the image and runs `/health`
   - Create-release job opens a draft GitHub Release with checksums attached

6. **Fill in the draft release notes**

   - Open the draft release on GitHub
   - Paste the CHANGELOG section for this version
   - Use `.github/release-notes-template.md` as the structure

7. **Publish the release** (click Publish Release)

## Verifying the published image

```bash
docker pull ghcr.io/your-org/calmly-sync:X.Y.Z

# Run a quick health check
docker run --rm \
  -e DATABASE_URL="postgresql://calmly:calmly@host.docker.internal:5432/calmly" \
  -e EMAIL_SENDER=console \
  -p 3001:3001 \
  ghcr.io/your-org/calmly-sync:X.Y.Z &

until curl -sf http://localhost:3001/health; do sleep 2; done
echo "Image verified."
```

## Hotfix process

For critical fixes:

1. Branch from the release tag: `git checkout -b hotfix/X.Y.Z+1 sync-vX.Y.Z`
2. Apply the fix, bump to `X.Y.Z+1`, update CHANGELOG
3. Tag `sync-vX.Y.Z+1` — the release workflow handles the rest
