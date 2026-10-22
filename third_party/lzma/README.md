# LZMA file decoder

`lzma-file-decoder.js` is the readable decompression-only `src/lzma-d.js` from
[LZMA-JS 2.3.2](https://github.com/LZMA-JS/LZMA-JS/tree/2.3.2), distributed under
the included MIT license. It runs as a classic worker, without eval or Blob URLs.

Three behavioral changes are required for uploaded binary files:

1. `decode(utf)` returns its byte array directly. Upstream's automatic conversion
   to strings loses non-canonical UTF-8 bytes, including `C0 80` and `ED A0 80`.
2. `$write_0` rejects output exceeding 8 MiB before copying it into the output
   array. This also bounds `.lzma` streams whose header has an unknown length.
3. `$read` throws on EOF. The upstream range decoder otherwise incorporates
   `-1` into its arithmetic and can silently return incorrect bytes from a
   truncated file, even when the declared output length is satisfied.

The generated-file banner was replaced to identify the adaptation. All other
decoder behavior is unchanged. The standard LZMA-Alone file format is retained.

`lzma-stream-decoder.js` is a separate adaptation for native uploaded files up
to 1 GiB. It retains the same MIT license and decoding arithmetic. A
`FileReaderSync` input reads 64 KiB slices and throws on EOF. A typed dictionary
is capped by the caller at 64 MiB, and output is flushed every 64 KiB into
256 KiB transferable chunks. The worker waits for an acknowledgement after
each output chunk, so disk writes provide backpressure. Known output lengths,
including zero, and unknown lengths with EOS are accepted; declared and actual
output lengths are checked without a whole-file output array. The original
small buffered decoder is unchanged.
