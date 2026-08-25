# Follow the system theme

When T3 Code runs on an Omarchy host, the server automatically detects the host's current theme.
Web and desktop clients can opt in from **Settings → Appearance → Follow system theme**. The option
is hidden unless the active, connected environment currently exposes a host theme. This is a
client-local choice: existing theme selections do not change, and each browser or desktop install
chooses independently.

The selection follows the active environment. Switching to an environment without an available
Omarchy palette falls back to T3 Code's normal appearance until a palette is available again. The
last selected palette is kept locally so startup and temporary offline periods do not flash a
different theme. Desktop window chrome follows the detected light or dark appearance as well.

T3 Code Mobile continues to use its device-local Appearance setting.

The server normally notices Omarchy theme replacements automatically. To reconcile immediately,
for example from a theme-change hook, run:

```sh
t3 theme refresh
```

The command reports `updated`, `unchanged`, or `unavailable`. Use `t3 theme refresh --json` for a
machine-readable status. It discovers and authenticates to the running T3 Code server; it does not
read or upload theme colors itself.
