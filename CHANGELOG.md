# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2026-07-29

### Changed

- Bumped `koonjs` to `^0.8.0`. The previous `^0.7.0` caret range could not
  resolve 0.8.0 — for `0.x` versions a caret pins the minor — so installs kept
  a nested koonjs 0.7.0 alongside any newer top-level copy.
- Bumped the MCP server version reported over the protocol to 0.8.0.
- Bumped `.claude-plugin/plugin.json` to 0.8.0. It was still on 0.6.0, having
  been missed during the 0.7.0 release.

## [0.7.0] - 2026-07-XX

Published to npm but never committed; recorded here for completeness.

### Fixed

- `timeout` is specified in seconds, not milliseconds. The client was
  constructed with `timeout: 30000`, which is 8.3 hours rather than the
  intended 30 seconds, so hung requests never timed out.

### Changed

- Bumped `koonjs` to `^0.7.0`.

## [0.6.0]

### Added

- Initial release: MCP server exposing `koon_fetch`, backed by koonjs browser
  impersonation, with HTML-to-markdown conversion and a 15-minute cache.
