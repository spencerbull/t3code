# Omarchy host theme integration

The Omarchy integration is optional and server-owned. The service is an explicit no-op outside
Linux. On Linux, its only filesystem inputs are resolved below the server user's home:

- `.local/state/omarchy/current/theme/colors.toml`
- `.local/state/omarchy/current/theme.name`

Clients cannot provide a path or palette. The server first invokes the installed
`omarchy-theme-color` with the argument array `--file <colors.toml> --all`. If that command is absent
or cannot produce a complete palette, a strict fallback accepts only Omarchy's flat quoted
`key = "value"` entries, then independently validates the required semantic colors. File identity,
size, and modification stamps must remain stable across the read, and the `theme.name` marker must
be at least as new as `colors.toml`, so the setter's theme-directory swap cannot be paired with its
previous name.

The watcher targets `.local/state/omarchy/current`, not the replaceable `theme` directory. Events are
debounced and coalesced before complete rereads. A previously valid palette gets two short rereads to
survive an atomic replacement window; if it remains unavailable, the server retracts `hostTheme`.
Normalized, revision-identical reads do not publish. A manual refresh uses the same path and returns
`updated`, `unchanged`, or `unavailable`.

`ServerConfig.hostTheme` is optional and contains only the theme name, light or dark appearance,
content revision, and ten semantic colors. Clients expand these semantic colors into their complete
theme role set. Host changes are sent as the existing version 1 full config snapshot, so older
clients ignore the additive field without a parallel state channel. The persisted client-runtime
`ServerConfig` cache strips `hostTheme` before saving; boot continuity comes from the dedicated
selected-theme cache described below, not from cached config.

`POST /api/server/theme/refresh` requires environment operate authorization and an empty payload.
The `t3 theme refresh` CLI follows the existing running-server discovery and ephemeral administrative
session flow. It never reads Omarchy files itself.

Web keeps `host:omarchy` as an internal local preference that cannot collide with valid imported
custom-theme IDs. Only a selected server palette and its environment ID are copied to the dedicated
`t3code:omarchy-theme:v1` boot cache; `ServerConfig` persistence deliberately omits the live
capability. Viewed-environment snapshots replace or clear the runtime palette, and revision or color
changes invalidate the rendered CSS. Mobile decodes the optional server config field but has no
follow-host control in this version.
