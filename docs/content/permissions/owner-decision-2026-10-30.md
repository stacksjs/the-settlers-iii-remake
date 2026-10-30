# Owner decision: publish credited demo media on the web channel

Recorded 2026-10-30 by the project owner, Chris Breuer.

**This is not a licence and not permission from the rights holders.** Blue Byte and Ubisoft have not granted this project any right to redistribute The Settlers III graphics, sound or maps. No such permission was requested or received.

## Decision

The project owner decided to serve the converted media from the free Amazons demo (SHA-256 `ac87c418101aadeb2338f04ecc79a56bf816ce1c6c7adc40bb7dc435ca4e7f65`) on the public web site, to signed-in players and in marketing screenshots, on these terms:

- **Credit everywhere the media appears or plays.** Every web page footer, every screenshot caption, the in-game guide and the credits page name Blue Byte and Ubisoft as the owners and describe this project as an unofficial, non-commercial fan remake.
- **Removal on request.** A rights holder who objects can contact chris@stacksjs.com or open a GitHub issue, and the material is removed promptly. Revoking this decision is a one line change: set the grant `owner-decision-2026-10-30` to `revoked` in `docs/content/policy.ts`, which blocks the web channel again.
- **Scope.** The `web` channel only, for the ten categories actually converted: ambience, buildings, generated metadata, goods and wares, interface and icons, settlers and soldiers, sound effects, terrain, tutorials, vegetation and deposits.
- **Nothing else changes.** The `preview`, `desktop`, `ios`, `android` and `github-release` channels stay blocked and still require recorded redistribution evidence from the rights holders.

## Risk accepted

The owner accepts the risk that the rights holders object, including a request to take the site down. The publication check treats this record as an owner decision (`owner-accepted`), distinct from reviewed evidence of permission, and the check output says so.
