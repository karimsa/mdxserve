---
name: mdxserve:run
description: Use when starting, stopping or reaching the mdxserve server, adding or removing the folders it serves, running it under oxmgr, or opening it from another device with tailscale serve. For writing the documents it serves, use the mdxserve skill.
allowed-tools: Bash, Read
---

# Running mdxserve

There is one mdxserve server per user. It listens on `127.0.0.1:4040` by default and serves
every folder mounted on it. Reuse the running server: add a folder to it instead of starting
a second one.

## 1. Check for a running server

```sh
mdxserve status
```

It prints the pid, the port and the served folders, or says no server is running. Add
`--json` to parse it. If one is running, skip to step 3.

## 2. Start it

With `oxmgr` installed, start it under `oxmgr` (step 4) so it outlives your session.
Otherwise:

```sh
mdxserve serve -w <dir>
```

- `-w <dir>` mounts a folder; repeat it for more. You can also start with none and add them
  later (step 3).
- `-p <n>` picks the port. When the port is taken, the server falls back to a free one and
  says so; read the port it printed, or `mdxserve status`.
- `--permissions full` (the default on loopback) lets the reader edit, comment and mount
  folders. `--permissions restricted` is read-only, serves exactly one `-w` folder, and needs
  its own `MDXSERVE_HOME` when another server is running.
- `--host <addr>` binds another interface. A non-loopback host defaults to restricted.
  `--dangerous-allow-network` allows full permissions there, which lets anyone on that
  network edit the documents. To reach the server from your own devices, use Tailscale
  (step 5) and keep the default host.

A foreground `mdxserve serve` stops when the shell that started it exits, and an agent's
shell exits with its session. Without `oxmgr`, ask the user to run it in their own terminal.

To stop a server: `oxmgr stop mdxserve` when `oxmgr` runs it, otherwise `kill <pid>` with
the pid from `mdxserve status`. There is no stop verb.

## 3. Add, list and remove folders

These act on the running server:

```sh
mdxserve roots add <dir> [<dir>...]
mdxserve roots list
mdxserve roots remove <dir> [<dir>...]
```

A folder may not be `/`, and may not sit inside or contain another mounted folder.

## 4. Run it under oxmgr

```sh
command -v oxmgr
oxmgr list
```

If `oxmgr list` shows an `mdxserve` entry, reuse it: `oxmgr status mdxserve` shows it and
`oxmgr logs mdxserve` shows its output, including the URLs and any Tailscale lines. Start
it if it is stopped: `oxmgr restart mdxserve`.

Otherwise start one:

```sh
oxmgr start --name mdxserve "mdxserve serve -w <dir>"
```

After upgrading mdxserve, run `oxmgr restart mdxserve` so the new version serves.

## 5. Open it from another device with Tailscale

`tailscale serve` publishes the loopback server to the user's tailnet over HTTPS. The
server keeps listening on `127.0.0.1`; live updates work through it.

The CLI is `tailscale` when it is on `PATH`. The Mac App Store build keeps it at
`/Applications/Tailscale.app/Contents/MacOS/Tailscale`, and on Windows it is
`C:\Program Files\Tailscale\tailscale.exe`.

When Tailscale is running and nothing publishes the server yet, the server prints the
command at startup (on stderr), with the CLI path and a free HTTPS port filled in. For a
server on port 4040 it is:

```sh
tailscale serve --bg --https=4040 http://127.0.0.1:4040
```

Then restart the server. It reads the Tailscale configuration once, at startup, so until
the restart a page opened through the tailnet address loads but gets no live updates.
After it, the server lists the address as `https://<machine>.<tailnet>.ts.net:4040`.

- Check what is published: `tailscale serve status`.
- Turn it off: `tailscale serve --https=4040 off`.
- Mount it at `/` with a target that has no path. A sub-path such as `--set-path=/docs`, or
  a target such as `http://127.0.0.1:4040/docs`, does not work, and the server says so.
- With full permissions, every device on the tailnet can edit the documents. Tell the user
  before running the command on a shared tailnet.
- `tailscale funnel` makes the address public on the internet. The server warns when a
  Funnel address reaches it with full permissions. Turn it off with
  `tailscale funnel --https=<port> off`, or restart with `--permissions restricted`.

To add the server to the mdxserve app on a phone, run `mdxserve qr`: it prints a QR code of
the tailnet address (or, with `--lan` or no tailnet address, the LAN one) to scan from
Servers, Add server, Scan a QR code. It exits 1 when no other device can reach the server.

Set `MDXSERVE_TAILSCALE_CLI=<path>` to use a specific CLI, or pass `--no-tailscale` to
`mdxserve serve` to skip all of this. Changing the Tailscale configuration is the user's
call: show them the command rather than running it unasked.
