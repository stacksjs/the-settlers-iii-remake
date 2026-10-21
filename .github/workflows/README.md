# GitHub Actions

These workflows run on GitHub:

- [CI][CI] checks lint, app and tool types, stx templates, and unit tests on Ubuntu. It imports the checksum-verified demo assets, validates the browser formats, and builds the game.
- [Release][Release] generates the changelog and creates a GitHub release for a `v*` tag.
- [Labeler][Labeler] labels pull requests from `.github/labeler.yml`.
- [Deploy][Deploy] runs manually with `buddy deploy` after a host and environment secrets are configured.
- [Preview][Preview] deploys configured pull request previews to `pr-<number>.<preview domain>` and removes them when the pull request closes. It skips deployment until preview credentials are configured.

[CI]: ./ci.yml
[Release]: ./release.yml
[Labeler]: ./labeler.yml
[Deploy]: ./deploy.yml
[Preview]: ./preview.yml
