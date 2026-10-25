param(
    [string]$Toolchain = 'stable',
    [string]$Sysroot,
    [string]$Linker,
    [string]$CargoHome
)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '../..'))
$installedToolchains = & rustup toolchain list
if ($LASTEXITCODE -ne 0 -or -not ($installedToolchains | Where-Object {
    $name = ($_ -split '\s+')[0]
    $name -eq $Toolchain -or $name.StartsWith("$Toolchain-")
})) { throw 'Select an already installed Rust toolchain. This script never installs one.' }
$compiler = & rustc "+$Toolchain" --version
if ($LASTEXITCODE -ne 0 -or $compiler -notmatch '^rustc 1\.85\.1 ') {
    throw 'This artifact is pinned to rustc 1.85.1. Select an installed matching toolchain explicitly; this script never installs or updates one.'
}
$previousFlags = $env:RUSTFLAGS
$previousEncodedFlags = $env:CARGO_ENCODED_RUSTFLAGS
$previousTarget = $env:CARGO_TARGET_DIR
$previousCargoHome = $env:CARGO_HOME
try {
    if ($CargoHome) { $env:CARGO_HOME = [IO.Path]::GetFullPath($CargoHome) }
    $effectiveCargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE '.cargo' }
    $flags = @("--remap-path-prefix=$projectRoot=/btools/brotli", "--remap-path-prefix=$effectiveCargoHome=/cargo")
    if ($Sysroot) {
        $resolvedSysroot = [IO.Path]::GetFullPath($Sysroot)
        if (-not (Test-Path -LiteralPath (Join-Path $resolvedSysroot 'lib/rustlib/wasm32-unknown-unknown/lib'))) { throw 'The provided sysroot does not contain wasm32 standard libraries.' }
        $flags += "--sysroot=$resolvedSysroot"
    }
    if ($Linker) { $flags += @('-C', "linker=$([IO.Path]::GetFullPath($Linker))") }
    # Encoded arguments preserve paths containing spaces without shell quoting.
    Remove-Item Env:RUSTFLAGS -ErrorAction SilentlyContinue
    $env:CARGO_ENCODED_RUSTFLAGS = $flags -join [char]31
    $env:CARGO_TARGET_DIR = Join-Path $repositoryRoot 'node_modules/.cache/brotli-file-encoder-build'
    & cargo "+$Toolchain" build --manifest-path (Join-Path $projectRoot 'Cargo.toml') --target wasm32-unknown-unknown --release --locked
    if ($LASTEXITCODE -ne 0) { throw 'Brotli WASM build failed.' }
    $artifact = Join-Path $env:CARGO_TARGET_DIR 'wasm32-unknown-unknown/release/btools_brotli_file_encoder.wasm'
    $destination = Join-Path $projectRoot 'brotli-file-encoder.wasm'
    Copy-Item -LiteralPath $artifact -Destination $destination -Force
    $metadata = [ordered]@{
        rustc = $compiler
        target = 'wasm32-unknown-unknown'
        profile = 'release (opt-level=3, lto=true, panic=abort)'
        wasmSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
        cargoLockSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $projectRoot 'Cargo.lock')).Hash.ToLowerInvariant()
    }
    $metadataJson = ($metadata | ConvertTo-Json).Replace("`r`n", "`n").Replace("`r", "`n") + "`n"
    [IO.File]::WriteAllText((Join-Path $projectRoot 'build-info.json'), $metadataJson, [Text.UTF8Encoding]::new($false))
    $notices = @('NOTICE', 'LICENSE-BSD-3-CLAUSE', 'LICENSE-APACHE-2.0') | ForEach-Object { Get-Content -LiteralPath (Join-Path $projectRoot $_) -Raw }
    $noticeText = ($notices -join "`n`n").Replace("`r`n", "`n").Replace("`r", "`n")
    [IO.File]::WriteAllText((Join-Path $repositoryRoot 'public/third-party-notices/brotli-file-encoder.txt'), $noticeText, [Text.UTF8Encoding]::new($false))
    Write-Output ($metadata | ConvertTo-Json)
} finally {
    if ($null -eq $previousFlags) { Remove-Item Env:RUSTFLAGS -ErrorAction SilentlyContinue } else { $env:RUSTFLAGS = $previousFlags }
    if ($null -eq $previousEncodedFlags) { Remove-Item Env:CARGO_ENCODED_RUSTFLAGS -ErrorAction SilentlyContinue } else { $env:CARGO_ENCODED_RUSTFLAGS = $previousEncodedFlags }
    if ($null -eq $previousTarget) { Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue } else { $env:CARGO_TARGET_DIR = $previousTarget }
    if ($null -eq $previousCargoHome) { Remove-Item Env:CARGO_HOME -ErrorAction SilentlyContinue } else { $env:CARGO_HOME = $previousCargoHome }
}
