# Install Apexo

Apexo is available as a terminal CLI and as a Desktop application. Both are
published to [GitHub Releases](https://github.com/cluster1900/apexo-code/releases).
The CLI is also available from npm as `apexo-code`; its command is `apexo`.

## Install the CLI with npm

Install [Node.js](https://nodejs.org/) 22 or newer, then run:

```bash
npm install -g apexo-code
apexo --version
apexo --help
```

To install exactly version 1.0.0:

```bash
npm install -g apexo-code@1.0.0
```

The package selects a prebuilt binary for your operating system, CPU, and Linux
libc. A separate Bun or Rust installation is not required. Do not pass
`--omit=optional`: the platform executable is an optional dependency.

If the shell cannot find `apexo`, run `npm prefix -g` and check your PATH. On
macOS/Linux the executable directory is `<prefix>/bin`; on Windows it is the
prefix itself. Open a new terminal after updating PATH. With a Node version
manager, use that manager's Node installation rather than running npm with sudo.

## Download the CLI from GitHub

Open the [latest release](https://github.com/cluster1900/apexo-code/releases/latest)
or [version 1.0.0](https://github.com/cluster1900/apexo-code/releases/tag/v1.0.0)
and expand **Assets**. These standalone archives need neither Node.js nor Bun.
Each archive contains the CLI **and** `apexo-workflow-script`. Keep both
executables together when installing or updating.

| System                                    | CPU                | CLI archive                            |
| ----------------------------------------- | ------------------ | -------------------------------------- |
| macOS                                     | Apple Silicon      | `apexo-darwin-arm64.zip`               |
| macOS                                     | Intel              | `apexo-darwin-x64.zip`                 |
| macOS                                     | Intel without AVX2 | `apexo-darwin-x64-baseline.zip`        |
| Linux, glibc (Ubuntu/Debian/Fedora, etc.) | x64                | `apexo-linux-x64.tar.gz`               |
| Linux, glibc                              | x64 without AVX2   | `apexo-linux-x64-baseline.tar.gz`      |
| Linux, glibc                              | arm64              | `apexo-linux-arm64.tar.gz`             |
| Linux, musl (Alpine)                      | x64                | `apexo-linux-x64-musl.tar.gz`          |
| Linux, musl                               | x64 without AVX2   | `apexo-linux-x64-baseline-musl.tar.gz` |
| Linux, musl                               | arm64              | `apexo-linux-arm64-musl.tar.gz`        |
| Windows                                   | x64                | `apexo-windows-x64.zip`                |
| Windows                                   | x64 without AVX2   | `apexo-windows-x64-baseline.zip`       |
| Windows                                   | arm64              | `apexo-windows-arm64.zip`              |

Check your architecture with `uname -m` on macOS/Linux, or
`[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture` in
PowerShell. `x86_64` means x64; `aarch64` means arm64. If an x64 executable exits
with an illegal-instruction error, use its baseline archive. Use `ldd --version`
on Linux to distinguish glibc from musl.

### macOS and Linux: install script

The script detects the platform, CPU, AVX2 support, and Linux libc. It installs
both executables under `~/.apexo/bin` and adds that directory to your shell
configuration when possible:

```bash
curl -fsSL https://raw.githubusercontent.com/cluster1900/apexo-code/main/install | bash
```

Pin the release:

```bash
curl -fsSL https://raw.githubusercontent.com/cluster1900/apexo-code/main/install | bash -s -- --version 1.0.0
```

For manual PATH management, add `--no-modify-path` and add `~/.apexo/bin` to PATH
yourself. Restart your terminal, then run `apexo --version`.

### Linux: manual installation

The example below installs the glibc x64 release. Replace the archive name with
the appropriate arm64, baseline, or musl variant from the table when needed.

```bash
curl -fLO https://github.com/cluster1900/apexo-code/releases/download/v1.0.0/apexo-linux-x64.tar.gz
mkdir -p "$HOME/.local/bin"
tar -xzf apexo-linux-x64.tar.gz -C "$HOME/.local/bin"
chmod +x "$HOME/.local/bin/apexo" "$HOME/.local/bin/apexo-workflow-script"
export PATH="$HOME/.local/bin:$PATH"
apexo --version
```

Add the PATH export to your shell configuration to persist it. The archive's
workflow interpreter belongs beside `apexo`; copying only the CLI leaves
workflow execution unavailable.

### macOS: manual installation

For Apple Silicon:

```bash
curl -fLO https://github.com/cluster1900/apexo-code/releases/download/v1.0.0/apexo-darwin-arm64.zip
mkdir -p "$HOME/.local/bin"
unzip -o apexo-darwin-arm64.zip -d "$HOME/.local/bin"
chmod +x "$HOME/.local/bin/apexo" "$HOME/.local/bin/apexo-workflow-script"
export PATH="$HOME/.local/bin:$PATH"
apexo --version
```

Use `apexo-darwin-x64.zip` on Intel Macs. Persist the PATH export in your shell
configuration. The CLI has an ad-hoc signature rather than an Apple Developer ID
signature. If a browser-downloaded executable is blocked, use the system's
**Privacy & Security** controls to review and allow it after verifying its origin
and checksum.

### Windows: manual installation

Run in PowerShell. Replace the archive name for arm64 or baseline CPUs as needed:

```powershell
$archive = "$env:TEMP\apexo-windows-x64.zip"
$installDir = "$env:LOCALAPPDATA\Apexo\bin"
Invoke-WebRequest https://github.com/cluster1900/apexo-code/releases/download/v1.0.0/apexo-windows-x64.zip -OutFile $archive
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Expand-Archive -Path $archive -DestinationPath $installDir -Force
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ';') -notcontains $installDir) {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
}
$env:Path = "$installDir;$env:Path"
apexo --version
```

Keep `apexo.exe` and `apexo-workflow-script.exe` in that directory. The PATH
change is available in newly opened terminals. Current Windows artifacts do not
have a publisher certificate, so Windows may display a trust prompt.

## Verify a GitHub download

Download `SHA256SUMS` from the **same release** as your archive. It covers the
CLI archives, Desktop installers, and npm tarballs. The checksum entries use
asset filenames, so put the downloaded files in the same directory.

On Linux:

```bash
sha256sum --ignore-missing -c SHA256SUMS
```

On macOS:

```bash
shasum -a 256 apexo-darwin-arm64.zip
```

Compare the result with the matching line in `SHA256SUMS`. In PowerShell:

```powershell
Get-FileHash .\apexo-windows-x64.zip -Algorithm SHA256
Select-String -Path .\SHA256SUMS -Pattern 'apexo-windows-x64.zip$'
```

Compare the hexadecimal hashes, ignoring letter case. A checksum detects an
incomplete or altered download; it does not replace checking the repository and
release you downloaded from.

## Install Desktop

Download the installer matching your system from the release Assets:

| System              | Desktop download                          | Installation                                                                                        |
| ------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon | `apexo-desktop-mac-arm64.dmg` (or `.zip`) | Open the DMG and drag Apexo to Applications; or extract the ZIP and move Apexo.app to Applications. |
| Linux x64           | `apexo-desktop-linux-x64.AppImage`        | Make executable with `chmod +x`, then run it.                                                       |
| Debian/Ubuntu x64   | `apexo-desktop-linux-x64.deb`             | `sudo apt install ./apexo-desktop-linux-x64.deb`                                                    |
| Fedora/RHEL x64     | `apexo-desktop-linux-x64.rpm`             | `sudo dnf install ./apexo-desktop-linux-x64.rpm`                                                    |
| Windows x64         | `apexo-desktop-win-x64.exe`               | Run the installer; it installs for the current user.                                                |

Only the Desktop architectures listed here have installers. The CLI supports
additional architectures. The current macOS Desktop build is ad-hoc signed and
not notarized; the Windows build has no publisher signature. Review operating
system trust prompts using the source repository and checksums above. For
macOS, use the system's **Privacy & Security** controls if the app is blocked.

Desktop includes its own runtime; installing npm or the CLI separately is not
required. There is no automatic Desktop updater: download and install the newer
version when upgrading.

## First run, updates, and removal

```bash
apexo auth login       # connect a provider or configure an API key
apexo models           # inspect available models
apexo                  # start the terminal UI in the current directory
apexo run "explain this project"
```

See the [README provider guide](../README.md#providers) for connection options.

For npm updates, run `npm install -g apexo-code@latest`. For standalone updates,
close running sessions and replace **both** executables with those from the new
archive, or rerun the install script. For removal, use `npm uninstall -g
apexo-code`, or delete the two manually installed executables. Remove any PATH
entry you added if its directory is no longer needed. Application data and
credentials are separate from executable files; removing a binary does not
remove them.

If several installations exist, run `command -v apexo` on macOS/Linux or
`Get-Command apexo -All` in PowerShell to see which one your shell will execute.
