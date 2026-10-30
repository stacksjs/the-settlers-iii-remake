# Owner decision: include credited demo media in GitHub releases

Recorded 2026-10-30 by the project owner, Chris Breuer, after being asked directly whether to extend the web decision to the `github-release` channel.

**This is not a licence and not permission from the rights holders.** Blue Byte and Ubisoft have not granted this project any right to redistribute The Settlers III graphics, sound or maps. No such permission was requested or received.

## Decision

The project owner decided that the installable build published as a GitHub release may include the same converted media from the free Amazons demo (SHA-256 `ac87c418101aadeb2338f04ecc79a56bf816ce1c6c7adc40bb7dc435ca4e7f65`) that the web site serves, on the terms of [the web decision](owner-decision-2026-10-30.md):

- **Credit everywhere the media appears or plays.** The release notes, the in-game guide and the credits page name Blue Byte and Ubisoft as the owners and describe this project as an unofficial, non-commercial fan remake.
- **Removal on request.** A rights holder who objects can contact chris@stacksjs.com or open a GitHub issue, and the release assets that contain the media are removed promptly. Revoking this decision is a one line change: set the grant `owner-decision-2026-10-30-github-release` to `revoked` in `docs/content/policy.ts`, which blocks the channel again.
- **Scope.** The `github-release` channel only, for the same ten converted categories as the web decision.
- **Nothing else changes.** The `preview`, `desktop`, `ios`, `android` channels stay blocked and still require recorded redistribution evidence from the rights holders.

## Risk accepted

The owner accepts the risk that the rights holders object, including a request to remove the release assets. The publication check treats this record as an owner decision (`owner-accepted`), distinct from reviewed evidence of permission, and says so.
