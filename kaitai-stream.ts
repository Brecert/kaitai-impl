import * as zlib from "https://deno.land/x/zlib.es@v1.0.0/mod.ts";

export type EncodeingType =
  | "ascii"
  | "utf8"
  | "utf-8"
  | "ucs2"
  | "ucs-2"
  | "utf16le"
  | "utf-16le";

export type KaitaiArrayLike = number[] | Uint8Array;

/**
  KaitaiStream is an implementation of Kaitai Struct API for JavaScript.
  Based on DataStream - https://github.com/kig/DataStream.js
  */
export class KaitaiStream {
  /**
  Creates an array from an array of character codes.
  Uses String.fromCharCode in chunks for memory efficiency and then concatenates
  the resulting string chunks.

  @param array Array of character codes.
  @return String created from the character codes.
**/
  static createStringFromArray = (array: KaitaiArrayLike): string => {
    const chunkSize = 0x8000;
    const chunks = [];
    let getChunk;
    if (array instanceof Uint8Array) {
      getChunk = array.subarray;
    } else {
      getChunk = array.slice;
    }
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(
        String.fromCharCode(...getChunk(i, i + chunkSize)),
      );
    }
    return chunks.join("");
  };

  /**
  Native endianness. Either KaitaiStream.BIG_ENDIAN or KaitaiStream.LITTLE_ENDIAN
  depending on the platform endianness.
  */
  static endianness = new Int8Array(new Int16Array([1]).buffer)[0] > 0;

  static bytesStripRight = (data: KaitaiArrayLike, padByte: number) => {
    let newLen = data.length;
    while (data[newLen - 1] === padByte) {
      newLen -= 1;
    }
    return data.slice(0, newLen);
  };

  static bytesTerminate = (
    data: KaitaiArrayLike,
    term: number,
    include: boolean,
  ) => {
    let newLen = 0;
    const maxLen = data.length;
    while (newLen < maxLen && data[newLen] !== term) {
      newLen += 1;
    }
    if (include && newLen < maxLen) {
      newLen += 1;
    }
    return data.slice(0, newLen);
  };

  static bytesToStr = (
    arr: KaitaiArrayLike | ArrayBuffer,
    encoding: EncodeingType,
  ) => {
    if (encoding == null || encoding.toLowerCase() === "ascii") {
      return KaitaiStream.createStringFromArray(arr as KaitaiArrayLike);
    } else {
      return new TextDecoder(encoding).decode(arr as ArrayBuffer);
    }
  };

  // ========================================================================
  // Byte array processing
  // ========================================================================

  static processXorOne = (data: ArrayLike<number>, key: number) => {
    const r = new Uint8Array(data.length);
    const dl = data.length;
    for (let i = 0; i < dl; i++) {
      r[i] = data[i] ^ key;
    }
    return r;
  };

  static processXorMany = (data: KaitaiArrayLike, key: ArrayLike<number>) => {
    const dl = data.length;
    const r = new Uint8Array(dl);
    const kl = key.length;
    let ki = 0;
    for (let i = 0; i < dl; i++) {
      r[i] = data[i] ^ key[ki];
      ki++;
      if (ki >= kl) {
        ki = 0;
      }
    }
    return r;
  };

  static processRotateLeft = (
    data: KaitaiArrayLike,
    amount: number,
    groupSize: number,
  ) => {
    if (groupSize !== 1) {
      throw `unable to rotate group of ${groupSize} bytes yet`;
    }

    const mask = groupSize * 8 - 1;
    const antiAmount = -amount & mask;

    const r = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      r[i] = ((data[i] << amount) & 0xff) | (data[i] >> antiAmount);
    }

    return r;
  };

  static processZlib = (buf: Uint8Array) => {
    return zlib.inflate(buf);
  };

  // ========================================================================
  // Misc runtime operations
  // ========================================================================

  static mod = (a: number, b: number) => {
    if (b <= 0) {
      throw "mod divisor <= 0";
    }
    let r = a % b;
    if (r < 0) {
      r += b;
    }
    return r;
  };

  static arrayMin = (arr: ArrayLike<number>) => {
    let min = arr[0];
    let x;
    for (let i = 1, n = arr.length; i < n; ++i) {
      x = arr[i];
      if (x < min) min = x;
    }
    return min;
  };

  static arrayMax = (arr: ArrayLike<number>) => {
    let max = arr[0];
    let x;
    for (let i = 1, n = arr.length; i < n; ++i) {
      x = arr[i];
      if (x > max) max = x;
    }
    return max;
  };

  static byteArrayCompare = (a: ArrayLike<number>, b: ArrayLike<number>) => {
    if (a === b) {
      return 0;
    }
    const al = a.length;
    const bl = b.length;
    const minLen = al < bl ? al : bl;
    for (let i = 0; i < minLen; i++) {
      const cmp = a[i] - b[i];
      if (cmp !== 0) {
        return cmp;
      }
    }

    // Reached the end of at least one of the arrays
    if (al === bl) {
      return 0;
    } else {
      return al - bl;
    }
  };

  _byteOffset: number;
  _buffer!: ArrayBuffer;
  _dataView!: DataView;
  /**
  Virtual byte length of the KaitaiStream backing buffer.
  Updated to be max of original buffer size and last written size.
  If dynamicSize is false is set to buffer size.
  */
  _byteLength = 0;
  bitsLeft = 0;
  bits = 0;
  pos: number;

  /**
   * 
   * @param arrayBuffer ArrayBuffer to read from.
   * @param byteOffset Offset from arrayBuffer beginning for the KaitaiStream.
   */
  constructor(arrayBuffer: ArrayBuffer, byteOffset?: number) {
    this._byteOffset = byteOffset || 0;
    if (arrayBuffer instanceof ArrayBuffer) {
      this.buffer = arrayBuffer;
    } else if (typeof arrayBuffer == "object") {
      this.dataView = arrayBuffer;
      if (byteOffset) {
        this._byteOffset += byteOffset;
      }
    } else {
      this.buffer = new ArrayBuffer(arrayBuffer || 1);
    }
    this.pos = 0;
    this.alignToByte();
  }

  /**
    Set/get the backing ArrayBuffer of the KaitaiStream object.
    The setter updates the DataView to point to the new buffer.
    */
  get buffer(): ArrayBuffer {
    this._trimAlloc();
    return this._buffer;
  }

  set buffer(v: ArrayBuffer) {
    this._buffer = v;
    this._dataView = new DataView(this._buffer, this._byteOffset);
    this._byteLength = this._buffer.byteLength;
  }

  /**
    Set/get the byteOffset of the KaitaiStream object.
    The setter updates the DataView to point to the new byteOffset.
    */
  get byteOffset(): number {
    return this._byteOffset;
  }

  set byteOffset(v: number) {
    this._byteOffset = v;
    this._dataView = new DataView(this._buffer, this._byteOffset);
    this._byteLength = this._buffer.byteLength;
  }

  /**
    Set/get the backing DataView of the KaitaiStream object.
    The setter updates the buffer and byteOffset to point to the DataView values.
    */
  get dataView(): DataView {
    return this._dataView;
  }

  set dataView({ byteOffset, buffer, byteLength }) {
    this._byteOffset = byteOffset;
    this._buffer = buffer;
    this._dataView = new DataView(this._buffer, this._byteOffset);
    this._byteLength = this._byteOffset + byteLength;
  }

  /**
    Internal function to trim the KaitaiStream buffer when required.
    Used for stripping out the extra bytes from the backing buffer when
    the virtual byteLength is smaller than the buffer byteLength (happens after
    growing the buffer with writes and not filling the extra space completely).
    */
  _trimAlloc(): void {
    if (this._byteLength === this._buffer.byteLength) {
      return;
    }
    const buf = new ArrayBuffer(this._byteLength);
    const dst = new Uint8Array(buf);
    const src = new Uint8Array(this._buffer, 0, dst.length);
    dst.set(src);
    this.buffer = buf;
  }

  // ========================================================================
  // Stream positioning
  // ========================================================================

  /**
    Returns true if the KaitaiStream seek pointer is at the end of buffer and
    there's no more data to read.

    @return True if the seek pointer is at the end of the buffer.
    */
  isEof(): boolean {
    return this.pos >= this.size && this.bitsLeft === 0;
  }

  /**
    Sets the KaitaiStream read/write position to given position.
    Clamps between 0 and KaitaiStream length.

    @param pos Position to seek to.
    */
  seek(pos: number): void {
    const npos = Math.max(0, Math.min(this.size, pos));
    this.pos = isNaN(npos) || !isFinite(npos) ? 0 : npos;
  }

  /** Returns the byte length of the KaitaiStream object. */
  get size(): number {
    return this._byteLength - this._byteOffset;
  }

  // ========================================================================
  // Integer numbers
  // ========================================================================

  // ------------------------------------------------------------------------
  // Signed
  // ------------------------------------------------------------------------

  /**
    Reads an 8-bit signed int from the stream.
    @return The read number.
    */
  readS1(): number {
    this.ensureBytesLeft(1);
    const v = this._dataView.getInt8(this.pos);
    this.pos += 1;
    return v;
  }

  // ........................................................................
  // Big-endian
  // ........................................................................

  /**
    Reads a 16-bit big-endian signed int from the stream.
    @return The read number.
    */
  readS2be(): number {
    this.ensureBytesLeft(2);
    const v = this._dataView.getInt16(this.pos);
    this.pos += 2;
    return v;
  }

  /**
    Reads a 32-bit big-endian signed int from the stream.
    @return The read number.
    */
  readS4be(): number {
    this.ensureBytesLeft(4);
    const v = this._dataView.getInt32(this.pos);
    this.pos += 4;
    return v;
  }

  /**
    Reads a 64-bit big-endian unsigned int from the stream. Note that
    JavaScript does not support 64-bit integers natively, so it will
    automatically upgrade internal representation to use IEEE 754
    double precision float.
    @return The read number.
    */
  readS8be(): number {
    this.ensureBytesLeft(8);
    const v1 = this.readU4be();
    const v2 = this.readU4be();

    if ((v1 & 0x80000000) !== 0) {
      // negative number
      return -(0x100000000 * (v1 ^ 0xffffffff) + (v2 ^ 0xffffffff)) - 1;
    } else {
      return 0x100000000 * v1 + v2;
    }
  }

  // ........................................................................
  // Little-endian
  // ........................................................................

  /**
    Reads a 16-bit little-endian signed int from the stream.
    @return The read number.
    */
  readS2le(): number {
    this.ensureBytesLeft(2);
    const v = this._dataView.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  /**
    Reads a 32-bit little-endian signed int from the stream.
    @return The read number.
    */
  readS4le(): number {
    this.ensureBytesLeft(4);
    const v = this._dataView.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /**
    Reads a 64-bit little-endian unsigned int from the stream. Note that
    JavaScript does not support 64-bit integers natively, so it will
    automatically upgrade internal representation to use IEEE 754
    double precision float.
    @return The read number.
    */
  readS8le(): number {
    this.ensureBytesLeft(8);
    const v1 = this.readU4le();
    const v2 = this.readU4le();

    if ((v2 & 0x80000000) !== 0) {
      // negative number
      return -(0x100000000 * (v2 ^ 0xffffffff) + (v1 ^ 0xffffffff)) - 1;
    } else {
      return 0x100000000 * v2 + v1;
    }
  }

  // ------------------------------------------------------------------------
  // Unsigned
  // ------------------------------------------------------------------------

  /**
    Reads an 8-bit unsigned int from the stream.
    @return The read number.
    */
  readU1(): number {
    this.ensureBytesLeft(1);
    const v = this._dataView.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  // ........................................................................
  // Big-endian
  // ........................................................................

  /**
    Reads a 16-bit big-endian unsigned int from the stream.
    @return The read number.
    */
  readU2be(): number {
    this.ensureBytesLeft(2);
    const v = this._dataView.getUint16(this.pos);
    this.pos += 2;
    return v;
  }

  /**
    Reads a 32-bit big-endian unsigned int from the stream.
    @return The read number.
    */
  readU4be(): number {
    this.ensureBytesLeft(4);
    const v = this._dataView.getUint32(this.pos);
    this.pos += 4;
    return v;
  }

  /**
    Reads a 64-bit big-endian unsigned int from the stream. Note that
    JavaScript does not support 64-bit integers natively, so it will
    automatically upgrade internal representation to use IEEE 754
    double precision float.
    @return The read number.
    */
  readU8be(): number {
    this.ensureBytesLeft(8);
    const v1 = this.readU4be();
    const v2 = this.readU4be();
    return 0x100000000 * v1 + v2;
  }

  // ........................................................................
  // Little-endian
  // ........................................................................

  /**
    Reads a 16-bit little-endian unsigned int from the stream.
    @return The read number.
    */
  readU2le(): number {
    this.ensureBytesLeft(2);
    const v = this._dataView.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  /**
    Reads a 32-bit little-endian unsigned int from the stream.
    @return The read number.
    */
  readU4le(): number {
    this.ensureBytesLeft(4);
    const v = this._dataView.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /**
    Reads a 64-bit little-endian unsigned int from the stream. Note that
    JavaScript does not support 64-bit integers natively, so it will
    automatically upgrade internal representation to use IEEE 754
    double precision float.
    @return The read number.
    */
  readU8le(): number {
    this.ensureBytesLeft(8);
    const v1 = this.readU4le();
    const v2 = this.readU4le();
    return 0x100000000 * v2 + v1;
  }

  // ========================================================================
  // Floating point numbers
  // ========================================================================

  // ------------------------------------------------------------------------
  // Big endian
  // ------------------------------------------------------------------------

  readF4be() {
    this.ensureBytesLeft(4);
    const v = this._dataView.getFloat32(this.pos);
    this.pos += 4;
    return v;
  }

  readF8be() {
    this.ensureBytesLeft(8);
    const v = this._dataView.getFloat64(this.pos);
    this.pos += 8;
    return v;
  }

  // ------------------------------------------------------------------------
  // Little endian
  // ------------------------------------------------------------------------

  readF4le() {
    this.ensureBytesLeft(4);
    const v = this._dataView.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readF8le() {
    this.ensureBytesLeft(8);
    const v = this._dataView.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  // ------------------------------------------------------------------------
  // Unaligned bit values
  // ------------------------------------------------------------------------

  alignToByte() {
    this.bits = 0;
    this.bitsLeft = 0;
  }

  readBitsIntBe(n: number) {
    // JS only supports bit operations on 32 bits
    if (n > 32) {
      throw new Error(
        `readBitsIntBe: the maximum supported bit length is 32 (tried to read ${n} bits)`,
      );
    }
    const bitsNeeded = n - this.bitsLeft;
    if (bitsNeeded > 0) {
      // 1 bit  => 1 byte
      // 8 bits => 1 byte
      // 9 bits => 2 bytes
      const bytesNeeded = Math.ceil(bitsNeeded / 8);
      const buf = this.readBytes(bytesNeeded);
      for (let i = 0; i < bytesNeeded; i++) {
        this.bits <<= 8;
        this.bits |= buf[i];
        this.bitsLeft += 8;
      }
    }

    // raw mask with required number of 1s, starting from lowest bit
    let mask = n === 32 ? 0xffffffff : (1 << n) - 1;
    // shift this.bits to align the highest bits with the mask & derive reading result
    const shiftBits = this.bitsLeft - n;
    const res = (this.bits >>> shiftBits) & mask;
    // clear top bits that we've just read => AND with 1s
    this.bitsLeft -= n;
    mask = (1 << this.bitsLeft) - 1;
    this.bits &= mask;

    return res;
  }

  readBitsIntLe(n: number) {
    // JS only supports bit operations on 32 bits
    if (n > 32) {
      throw new Error(
        `readBitsIntLe: the maximum supported bit length is 32 (tried to read ${n} bits)`,
      );
    }
    const bitsNeeded = n - this.bitsLeft;
    if (bitsNeeded > 0) {
      // 1 bit  => 1 byte
      // 8 bits => 1 byte
      // 9 bits => 2 bytes
      const bytesNeeded = Math.ceil(bitsNeeded / 8);
      const buf = this.readBytes(bytesNeeded);
      for (let i = 0; i < bytesNeeded; i++) {
        this.bits |= buf[i] << this.bitsLeft;
        this.bitsLeft += 8;
      }
    }

    // raw mask with required number of 1s, starting from lowest bit
    const mask = n === 32 ? 0xffffffff : (1 << n) - 1;
    // derive reading result
    const res = this.bits & mask;
    // remove bottom bits that we've just read by shifting
    this.bits >>= n;
    this.bitsLeft -= n;

    return res;
  }

  // ========================================================================
  // Byte arrays
  // ========================================================================

  readBytes(len: number) {
    return this.mapUint8Array(len);
  }

  readBytesFull() {
    return this.mapUint8Array(this.size - this.pos);
  }

  readBytesTerm(
    terminator: number,
    include: boolean,
    consume: boolean,
    eosError: boolean,
  ) {
    const blen = this.size - this.pos;
    const u8 = new Uint8Array(this._buffer, this._byteOffset + this.pos);
    let i;
    for (i = 0; i < blen && u8[i] !== terminator; i++); // find first zero byte
    if (i === blen) {
      // we've read all the buffer and haven't found the terminator
      if (eosError) {
        throw `End of stream reached, but no terminator ${terminator} found`;
      } else {
        return this.mapUint8Array(i);
      }
    } else {
      let arr;
      if (include) {
        arr = this.mapUint8Array(i + 1);
      } else {
        arr = this.mapUint8Array(i);
      }
      if (consume) {
        this.pos += 1;
      }
      return arr;
    }
  }

  // Unused since Kaitai Struct Compiler v0.9+ - compatibility with older versions
  ensureFixedContents(expected: number[]) {
    const actual = this.readBytes(expected.length);
    if (actual.length !== expected.length) {
      throw new UnexpectedDataError(expected, actual);
    }
    const actLen = actual.length;
    for (let i = 0; i < actLen; i++) {
      if (actual[i] !== expected[i]) {
        throw new UnexpectedDataError(expected, actual);
      }
    }
    return actual;
  }

  /**
    Ensures that we have an least `length` bytes left in the stream.
    If that's not true, throws an EOFError.

    @param length Number of bytes to require
    */
  ensureBytesLeft(length: number) {
    if (this.pos + length > this.size) {
      throw new EOFError(length, this.size - this.pos);
    }
  }

  /**
    Maps a Uint8Array into the KaitaiStream buffer.

    Nice for quickly reading in data.

    @param length Number of elements to map.
    @return Uint8Array to the KaitaiStream backing buffer.
    */
  mapUint8Array(length: number): Uint8Array {
    length |= 0;

    this.ensureBytesLeft(length);

    const arr = new Uint8Array(
      this._buffer,
      this.byteOffset + this.pos,
      length,
    );
    this.pos += length;
    return arr;
  }
}

// ========================================================================
// Internal implementation details
// ========================================================================

export class EOFError extends Error {
  name = "EOFError";

  constructor(public bytesRequired: number, public bytesAvailable: number) {
    super(
      `requested ${bytesRequired} bytes, but only ${bytesAvailable} bytes available`,
    );
  }
}

// Unused since Kaitai Struct Compiler v0.9+ - compatibility with older versions
export class UnexpectedDataError extends Error {
  constructor(
    public expected: KaitaiArrayLike,
    public actual: KaitaiArrayLike,
  ) {
    super(`expected [${expected}], but got [${actual}]`);
  }
}

export class UndecidedEndiannessError extends Error {
  name = "UndecidedEndiannessError";
}

export class ValidationNotEqualError extends Error {
  name = "ValidationNotEqualError";

  constructor(
    public expected: KaitaiArrayLike,
    public actual: KaitaiArrayLike,
  ) {
    super(`not equal, expected [${expected}], but got [${actual}]`);
  }
}

export class ValidationLessThanError extends Error {
  name = "ValidationLessThanError";

  constructor(public min: number, public actual: number) {
    super(`not in range, min [${min}], but got [${actual}]`);
  }
}

export class ValidationGreaterThanError extends Error {
  name = "ValidationGreaterThanError";

  constructor(public max: number, public actual: number) {
    super(`not in range, max [${max}], but got [${actual}]`);
  }
}

export class ValidationNotAnyOfError extends Error {
  name = "ValidationNotAnyOfError";

  constructor(actual: number[]) {
    super(`not any of the list, got [${actual}]`);
  }
}

export class ValidationExprError extends Error {
  name = "ValidationExprError";

  constructor(actual: number[]) {
    super(`not matching the expression, got [${actual}]`);
  }
}
