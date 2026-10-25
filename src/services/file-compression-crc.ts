// IEEE CRC32 (the reflected 0xedb88320 polynomial used by existing BTF2 records).
const table = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})

/** Accepts and returns an unfinalized CRC state, including for empty byte views. */
export function updateCrc(crc: number, bytes: Uint8Array): number {
  for (let index = 0; index < bytes.length; index++) crc = (crc >>> 8) ^ table[(crc ^ bytes[index]) & 255]
  return crc
}

export function crcHex(crc: number): string { return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0') }
export function checksum(bytes: Uint8Array): string { return crcHex(updateCrc(0xffffffff, bytes)) }

function matrixTimes(matrix: Uint32Array, vector: number): number {
  let result = 0
  let index = 0
  while (vector) {
    if (vector & 1) result ^= matrix[index]
    vector >>>= 1
    index++
  }
  return result >>> 0
}

function matrixSquare(matrix: Uint32Array): Uint32Array {
  return Uint32Array.from(matrix, (vector) => matrixTimes(matrix, vector))
}

// powers[n] applies 2**n zero bytes. Reused across the file's equal-sized blocks.
let zeroBytePowers: Uint32Array[] | undefined
function bytePowers(): Uint32Array[] {
  if (zeroBytePowers) return zeroBytePowers
  const oneBit = new Uint32Array(32)
  oneBit[0] = 0xedb88320
  for (let index = 1, row = 1; index < 32; index++, row <<= 1) oneBit[index] = row
  const twoBits = matrixSquare(oneBit)
  zeroBytePowers = [matrixSquare(matrixSquare(twoBits))]
  return zeroBytePowers
}

/** CRC32(A ++ B) from finalized, unsigned block CRCs, without rescanning A or B. */
export function combineCrc32(first: number, second: number, secondLength: number): number {
  if (!Number.isSafeInteger(first) || first < 0 || first > 0xffffffff ||
    !Number.isSafeInteger(second) || second < 0 || second > 0xffffffff) throw new RangeError('CRC32 must be an unsigned 32-bit integer')
  if (!Number.isSafeInteger(secondLength) || secondLength < 0) throw new RangeError('CRC byte length must be a non-negative safe integer')
  if (!secondLength) return first
  const powers = bytePowers()
  let index = 0
  let length = secondLength
  let combined = first
  while (length) {
    if (index >= powers.length) powers.push(matrixSquare(powers[index - 1]))
    if (length % 2) combined = matrixTimes(powers[index], combined)
    length = Math.floor(length / 2)
    index++
  }
  return (combined ^ second) >>> 0
}
