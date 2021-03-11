/**
 * A variable-length unsigned integer using base128 encoding. 1-byte groups
 * consist of 1-bit flag of continuation and 7-bit value chunk, and are ordered
 * "most significant group first", i.e. in "big-endian" manner.
 * 
 * This particular encoding is specified and used in:
 * 
 * * Standard MIDI file format
 * * ASN.1 BER encoding
 * 
 * More information on this encoding is available at
 * https://en.wikipedia.org/wiki/Variable-length_quantity
 * 
 * This particular implementation supports serialized values to up 8 bytes long.
 */

import { KaitaiImpl } from "../../mod.ts";

export class VlqBase128Be extends KaitaiImpl {
  groups!: Group[];

  read() {
    this.groups = [];
    let group;
    do {
      group = new Group(this._io, this, this._root);
      this.groups.push(group);
    } while (group.hasNext);
  }

  #last?: number;
  get last() {
    if (this.#last !== undefined) {
      return this.#last;
    }
    this.#last = (this.groups.length - 1);
    return this.#last;
  }

  #value?: number;
  /**
   * Resulting value as normal integer
   */
  get value() {
    if (this.#value !== undefined) {
      return this.#value;
    }
    this.#value = (((((((this.groups[this.last].value +
      (this.last >= 1 ? (this.groups[(this.last - 1)].value << 7) : 0)) +
      (this.last >= 2 ? (this.groups[(this.last - 2)].value << 14) : 0)) +
      (this.last >= 3 ? (this.groups[(this.last - 3)].value << 21) : 0)) +
      (this.last >= 4 ? (this.groups[(this.last - 4)].value << 28) : 0)) +
      (this.last >= 5 ? (this.groups[(this.last - 5)].value << 35) : 0)) +
      (this.last >= 6 ? (this.groups[(this.last - 6)].value << 42) : 0)) +
      (this.last >= 7 ? (this.groups[(this.last - 7)].value << 49) : 0));
    return this.#value;
  }
}

/**
 * One byte group, clearly divided into 7-bit "value" chunk and 1-bit "continuation" flag.
 */
export class Group extends KaitaiImpl {
  b!: number;
  read() {
    this.b = this._io.readU1();
  }

  #hasNext?: boolean;
  /**
   * If true, then we have more bytes to read
   */
  get hasNext() {
    if (this.#hasNext !== undefined) {
      return this.#hasNext;
    }
    this.#hasNext = (this.b & 128) != 0;
    return this.#hasNext;
  }

  #value?: number;
  /**
   * The 7-bit (base128) numeric value chunk of this group
   */
  get value() {
    if (this.#value !== undefined) {
      return this.#value;
    }
    this.#value = (this.b & 127);
    return this.#value;
  }
}
