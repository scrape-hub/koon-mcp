# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-09-29

### Fixed

- PDFs were returned as binary content. `koon_fetch` now returns their text
  with page numbers, long PDFs up to about 16,000 characters.

### Added

- `pages`: further pages of a PDF, without downloading it again.
- Papers with a DOI or arXiv id get title, authors, year and DOI.
- `save`: keeps a PDF in `pdf/` of the project folder.

## [1.0.0] - 2026-09-28

### Changed

- Built on koon 1.0.0 (`koonjs` `^1.0.0`), whose browser fingerprints were
  rebuilt against real browser traffic on TLS, HTTP/2 and HTTP/3.
- Fetches as the latest Chrome koon knows instead of the fixed Chrome 145,
  whose fingerprint no longer matched the Chrome that sites see today.
- The MCP server reports version 1.0.0.

### Added

- `.claude-plugin/marketplace.json`, so `claude plugin marketplace add
  scrape-hub/koon-mcp` works as the README describes. Before, the repository
  had no marketplace file and the command failed.
- A LICENSE file with the MIT license the package already declared.

### Fixed

- A page's CSS and script errors no longer reach stderr as stack traces on
  every fetch; JSDOM now gets a console of its own.
- The README's comparison with Node.js `fetch` is measured again. Five of
  the ten sites no longer block plain `fetch` and were dropped from it.

## [0.8.1] - 2026-08-18

### Changed

- Picks up koon 0.8.1, which adds profiles for the current stable browsers
  (Chrome 152, Firefox 154, Edge 151, Opera 134, Safari 26.6) and corrects the
  TLS fingerprints of Chrome 150+ and Firefox 151+. The `^0.8.0` range already
  allowed it; the lockfile is updated so fresh installs actually get it.
- Bumped the MCP server version reported over the protocol to 0.8.1.

## [0.8.0] - 2026-07-29

### Changed

- Bumped `koonjs` to `^0.8.0`. The previous `^0.7.0` caret range could not
  resolve 0.8.0 (for `0.x` versions a caret pins the minor), so installs kept
  a nested koonjs 0.7.0 alongside any newer top-level copy.
- Bumped the MCP server version reported over the protocol to 0.8.0.
- Bumped `.claude-plugin/plugin.json` to 0.8.0. It was still on 0.6.0, having
  been missed during the 0.7.0 release.

## [0.7.0] - 2026-03-24

Published to npm but never committed; recorded here for completeness.

### Fixed

- `timeout` is specified in seconds, not milliseconds. The client was
  constructed with `timeout: 30000`, which is 8.3 hours rather than the
  intended 30 seconds, so hung requests never timed out.

### Changed

- Bumped `koonjs` to `^0.7.0`.

## [0.6.0] - 2026-03-17

### Added

- Initial release: MCP server exposing `koon_fetch`, backed by koonjs browser
  impersonation, with HTML-to-markdown conversion and a 15-minute cache.
