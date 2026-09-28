# Bird Chaser beta testing

TestFlight is the primary tester channel once the Apple Developer membership
is active. The GitHub Release's unsigned IPA remains the Sideloadly fallback.
Each released IPA is accompanied by a generated tester guide containing that
artifact's exact version, SHA-256 checksum, build ID, and 30-day Bird Chaser
expiry.

Install Sideloadly only from <https://sideloadly.io/> and follow its current
official FAQ. Testers sign with their own Apple account; they must never send
their Apple password to the project owner. A free Apple account's usual
seven-day signing window is independent of Bird Chaser's build expiry.

Beta builds expose **Settings > Beta testing > Create diagnostic package**.
The tester reviews the included/redacted inventory before sharing. Nothing is
uploaded automatically. A screenshot is captured only when the tester checks
**Include current screenshot** and then taps **Share diagnostic package**.
Cancelling the iOS share sheet sends nothing and is reported as cancelled.

Expired sideload builds block ordinary app/network use but retain diagnostic
export, local-data deletion, and the link to install a newer beta.
