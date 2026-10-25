# File Brotli encoder

`brotli-file-encoder.wasm` is built from the checked-in C ABI in `src/lib.rs`
and the exact codec versions/checksums in `Cargo.lock`. It is used only by file
compression workers. Ordinary text compression and the existing decompressor
continue using the npm module.

The encoder follows [brotli-wasm v3.0.1's one-shot implementation](https://github.com/httptoolkit/brotli-wasm/blob/v3.0.1/src/lib.rs):
`Vec::new()`, `BrotliEncoderParams::default()`, `quality=11`, and the same byte
slice reader passed to `BrotliCompress`. Block size, window/mode/default
parameters, BTF2 records and checksums do not change. The difference is the
small C ABI and throughput build (`opt-level=3`, LTO). Each worker owns one
instance; worker termination releases its linear memory.

## Rebuild

Install Rust **1.85.1** and its `wasm32-unknown-unknown` standard library first.
The script does not install/update tools. From the repository root:

```powershell
./third_party/brotli/build.ps1 -Toolchain 1.85.1
```

An existing `stable` alias that reports exactly 1.85.1 is also accepted. The
script uses `--locked`, normalizes project/registry paths, writes the binary,
updates `build-info.json` with compiler and SHA256 values, and regenerates the
notices copied to the extension package. Normal Vite builds consume the
checked-in binary and need no Rust installation or network access.

For an offline/isolated toolchain, `-Sysroot`, `-Linker` and `-CargoHome` may
point to existing directories/files. The sysroot must contain the exact Rust
1.85.1 wasm target standard libraries. Do not substitute an arbitrary wasm
binary or silently update the pinned codec dependencies.

## Verification and ABI

`file-brotli.spec.ts` executes the bundled binary and compares byte-for-byte
with the existing Brotli 11 implementation, then decodes it independently.
Full-file/1 GiB extension verification covers the worker, OPFS and BTF2 path.
Compare `build-info.json` hashes after a rebuild before committing the asset.

The host allocates input with `bt_alloc`, initializes all bytes, and calls
`bt_compress`. The returned 16-byte little-endian descriptor stores output
pointer, output size, status, and a reserved word. The host copies output
before `bt_result_free`, and always calls `bt_free` for the input. No host
imports, shared memory, eval, dynamic code or external resources are needed.

See `NOTICE` and the accompanying Apache-2.0/BSD-3-Clause licenses. The same
notices are included in `public/third-party-notices/brotli-file-encoder.txt`.
