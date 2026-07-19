# ShinShell Remote — Android TWA (Bubblewrap)

Crib sheet, not a manual. `remote/twa/` wraps the Remote PWA (docs on the PWA
itself: see `remote/`'s own comments and `src/main/remote/server.ts`) into a
Trusted Web Activity — an Android APK that's really just Chrome pointed at
the PWA's real HTTPS origin, verified via Digital Asset Links so it opens
chromeless instead of showing an address bar.

**Package ID:** `com.shintech.shinshell.remote`
**Signing identity:** self-signed, generated locally — see Secrets below.

## The one thing that makes this fragile

The TWA is bound to a literal origin: `scarlettwitch.tail9249a1.ts.net:8443`
(this machine's Tailscale MagicDNS name), baked into `twa-manifest.json`'s
`host`/`webManifestUrl`/`fullScopeUrl` fields *and* into `assetlinks.json`.
If ShinShell Remote ever runs from a different machine (different MagicDNS
name), the APK has to be regenerated against the new host — there's no
"just repoint it," the host is load-bearing for both the start URL and the
Digital Asset Links check. A phone off the tailnet, or on a tailnet where
this machine's cert domain has changed, will see the TWA silently degrade to
a Custom Tab with a visible address bar (Chrome's own fallback when asset
link verification fails) rather than fail outright — that's the symptom to
look for if a rebuilt app suddenly shows a URL bar.

## Troubleshooting: URL bar shows up (TWA falls back to a Custom Tab)

Content loads fine but Chrome still shows the address bar — hit this on
first real install, root-caused live. Two different causes, same symptom:

1. **The obvious one:** the real ShinShell Remote server isn't actually
   running (desktop app closed, or Remote toggled off), so there's nothing
   at the host:port to verify against at all.

2. **The one that actually bit us, server up and content loading fine:**
   `express.static()`'s default `dotfiles: 'ignore'` option skips *any* path
   with a dot-prefixed segment — and `.well-known` is one. A request for
   `/.well-known/assetlinks.json` silently fell through past `express.static`
   to `server.ts`'s SPA catch-all, which served `index.html` (200 OK, valid
   HTTP, wrong content) instead of 404ing or serving the real file. Chrome's
   asset-link fetch got HTML back where it expected JSON, failed to parse
   it, and quietly fell back to a Custom Tab — no error surfaced anywhere in
   the app UI, just a URL bar that shouldn't be there. Confirm with:

   ```bash
   curl -sk https://<host>:<port>/.well-known/assetlinks.json
   # If this prints an <html> doctype instead of the JSON blob, that's the bug.
   ```

   Fixed for good in `server.ts` — `express.static(pwaDistDir, { dotfiles:
   'allow' })` — so this shouldn't recur, but if `server.ts`'s static
   middleware setup ever gets touched again, this is the regression to
   watch for.

   To actually see *why* verification failed (rather than just knowing that
   it did), pull logs off the device around a fresh launch:

   ```bash
   adb logcat -c
   adb shell am force-stop com.shintech.shinshell.remote
   adb shell am force-stop com.android.chrome
   adb shell am start -n com.shintech.shinshell.remote/.LauncherActivity
   adb logcat -d | grep -iE "digital_asset_links|originverifier"
   ```

   A parse error (`expected value at line 1 column 1`) means the response
   body wasn't JSON at all — check what's actually being served, per above,
   before assuming it's a fingerprint mismatch. On success, a "Running in
   Chrome" toast appears briefly and the address bar is gone — that toast
   *is* the confirmation the TWA relationship verified, not just that the
   page loaded.

## Rebuilding after a PWA change

```powershell
# 1. Rebuild the PWA bundle — twa-manifest.json's icons/manifest come from dist/.
cd remote
npm run build

# 2. bubblewrap needs to fetch the manifest + icons over *real* HTTPS from the
#    exact host:port in twa-manifest.json — it has no local-file mode. Either
#    have ShinShell itself running with Remote turned on, or stand up a
#    throwaway stand-in (this is what was used to build the first APK):
tailscale cert --cert-file=cert.pem --key-file=key.pem scarlettwitch.tail9249a1.ts.net
# then a minimal `https.createServer` serving remote/dist, bound to the
# tailnet IP (`tailscale status --json` → Self.TailscaleIPs) on :8443.

# 3. Build + sign. Setting these env vars skips bubblewrap's interactive
#    keystore-password prompt entirely (see Secrets for the password file):
cd twa
$env:BUBBLEWRAP_KEYSTORE_PASSWORD = Get-Content keystore-credentials.txt -Raw
$env:BUBBLEWRAP_KEY_PASSWORD = $env:BUBBLEWRAP_KEYSTORE_PASSWORD
bubblewrap build --skipPwaValidation
```

`bubblewrap build` still asks one interactive yes/no ("No checksum file was
found... regenerate your project?") the first time, and again any time
`twa-manifest.json` changes — answer `Y`. It also silently bumps
`appVersionCode`/`appVersionName` by 1 on that regenerate step (there's no
flag to suppress this on `build`, only on the separate `update` command) —
expected, not a bug; the app is currently at versionCode 2.

### If `bubblewrap build` dies on the Gradle step

```
ERROR Command failed: gradlew.bat assembleRelease --stacktrace
'gradlew.bat' is not recognized as an internal or external command,
```

Hit this from Git Bash — bubblewrap's `GradleWrapper` spawns the bare
`gradlew.bat` (relies on Windows' cwd search for the child process), which
doesn't resolve reliably through Git Bash's shell layer. Workaround: run the
Gradle steps yourself, then hand off to `bubblewrap` (or `apksigner`
directly) for signing:

```bash
cd remote/twa
cmd //c ".\gradlew.bat assembleRelease --stacktrace"   # note the leading .\
```

This needs `local.properties` with `sdk.dir=<androidSdkPath>` present (same
value as `bubblewrap doctor`'s `androidSdkPath` — gitignored, machine-specific,
recreate it if missing).

### Signing manually (same situation, or if `bubblewrap build`'s own signing step didn't run)

```bash
cd remote/twa
cp app/build/outputs/apk/release/app-release-unsigned.apk app-release-unsigned-aligned.apk
# zipalign -c -v 4 app-release-unsigned-aligned.apk   # confirm it's already aligned (AGP usually does this)

# apksigner's --ks-pass/--key-pass env: source hit a "Password is not ASCII"
# error going through a Git-Bash-exported Windows env var — use file: instead.
# file: reads one line per password prompt, so the file needs the password
# on two lines (ks-pass consumes line 1, key-pass consumes line 2):
printf '%s\n%s\n' "$(cat keystore-credentials.txt)" "$(cat keystore-credentials.txt)" > /tmp/pw2.txt
"<androidSdkPath>/build-tools/35.0.0/apksigner.bat" sign \
  --ks shinshell-remote.keystore --ks-key-alias shinshell-remote \
  --ks-pass file:/tmp/pw2.txt --key-pass file:/tmp/pw2.txt \
  --out app-release-signed.apk app-release-unsigned-aligned.apk
rm /tmp/pw2.txt
```

Verify: `apksigner.bat verify --print-certs app-release-signed.apk` — the
printed SHA-256 cert digest (colons stripped, lowercase) must match
`sha256_cert_fingerprints` in `remote/public/.well-known/assetlinks.json`
and `remote/twa/twa-manifest.json`'s `fingerprints`. If you ever re-generate
the keystore, regenerate `assetlinks.json` too:
`bubblewrap fingerprint generateAssetLinks`, then copy the result into
`remote/public/.well-known/assetlinks.json` (the PWA build copies
`public/` verbatim into `dist/`, which is what `server.ts` serves statically
— nothing else wires this up, it's just a static file at the right path).

## Installing

```
adb install remote/twa/app-release-signed.apk
```

Or copy the APK to the phone and open it (Chrome will need "install unknown
apps" permission granted for whatever app served the file). The phone must
be on the same tailnet — MagicDNS is what resolves the host, same
requirement as using the PWA in a mobile browser today.

## Secrets

`remote/twa/shinshell-remote.keystore` and `keystore-credentials.txt` are
gitignored and exist only on this machine. **Back the keystore + password up
somewhere durable** — this is a self-signed key with no Play App Signing
enrollment, so losing it means every future build is a *different*
signing identity: Android treats it as a different app, existing installs
can't upgrade in place, and `assetlinks.json` needs a new fingerprint.
`local.properties` (SDK path) and all Gradle build output are also
gitignored — regenerate rather than hunt for them if missing.
