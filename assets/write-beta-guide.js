'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const [, , ipaPath, buildInfoPath, outputPath] = process.argv;
if (!ipaPath || !buildInfoPath || !outputPath) {
  throw new Error('Usage: node assets/write-beta-guide.js <ipa> <build-info.js> <output>');
}
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(buildInfoPath, 'utf8'), sandbox);
const info = sandbox.window.__BUILD_INFO__;
if (!info || info.channel !== 'sideload' || !info.expiresAt) {
  throw new Error('The packaged build is not a time-limited sideload beta');
}
const ipa = fs.readFileSync(ipaPath);
const checksum = crypto.createHash('sha256').update(ipa).digest('hex');
const version = require(path.resolve('package.json')).version;
const text = `Bird Chaser ${version} — sideload beta tester guide

Artifact: ${path.basename(ipaPath)}
SHA-256: ${checksum}
Build ID: ${info.buildId}
Built: ${info.builtAt}
Bird Chaser beta expiry: ${info.expiresAt}

PRIMARY CHANNEL — TESTFLIGHT

When the Apple Developer membership is active, install the build from the
owner's TestFlight invitation. TestFlight builds stop working after 90 days.
Use TestFlight's screenshot/comment action for visual defects. For app-specific
state, open Bird Chaser Settings > Beta testing > Create diagnostic package,
review the inventory, then choose Share.

SIDELOADLY FALLBACK

1. Download the IPA only from this GitHub Release. Verify its SHA-256 against
   the value above.
2. Download Sideloadly only from https://sideloadly.io/ and follow its current
   official prerequisites. On Windows, use the Apple iTunes/iCloud components
   named by Sideloadly's current FAQ.
3. Connect and trust the iPhone, drag the IPA into Sideloadly, and sign it with
   your own Apple account. Never send an Apple password to the Bird Chaser
   owner or another tester.
4. Complete Apple's Developer Mode and developer-app trust prompts if iOS asks.
   Do not bypass warnings that identify software as unsafe or untrusted.
5. A free Apple account normally requires re-signing after seven days. That is
   separate from the Bird Chaser expiry printed above. Reinstalling the same
   bundle ID normally preserves local data, but export diagnostics first if the
   data matters.

WHEN THE BETA EXPIRES

Ordinary app use and network requests stop. The expiry page still allows:
- Create and share a diagnostic package
- Delete Bird Chaser data from this device
- Open the latest Releases page to install a newer beta

SEND A BUG

Open Settings > Beta testing > Create diagnostic package. Read the preview.
Optionally add a short note and explicitly select Include current screenshot.
Tap Share diagnostic package and choose Mail, AirDrop, Files, or another
destination. Cancelling the share sheet sends nothing.

DELETE / UNINSTALL

Use Settings > Erase all app data before uninstalling if you want Bird Chaser
to clear its own caches, imported list, API key, favourites, home settings and
signed-in eBird browser session. Then remove the app with the normal iOS app
deletion control.
`;
fs.writeFileSync(outputPath, text);
console.log(`Wrote ${outputPath}`);
