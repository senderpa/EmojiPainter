# Releasing EmojiPainter

This repository uses semantic version tags. The source release version follows `package.json`;
the App Store versions are managed and released separately.

## Prepare a source release

1. Choose the next version and update `package.json` and `package-lock.json` together.
2. Move the matching entry in `CHANGELOG.md` from Unreleased to the release date. Summarize user-
   facing changes and link to any important migration or setup notes.
3. Review the full diff and confirm it contains no local settings, credentials, signing files,
   generated output, or assets that are outside the public-source boundary.
4. Run the checks listed in `CONTRIBUTING.md` and review the GitHub Actions results. For native
   changes, follow the applicable build steps in `docs/BUILDING.md` and report the device or
   simulator coverage accurately.
5. Commit the release changes, create an annotated `vX.Y.Z` tag, and push the commit and tag to
   `main` and `origin`.
6. Create a GitHub Release from that tag. Include concise notes, build instructions, known asset or
   backend requirements, and links to any separately distributed app binaries.

GitHub automatically provides source archives for each tagged release. This repository's source
release does not bundle signed iOS or Mac binaries; those are distributed through the App Store.
