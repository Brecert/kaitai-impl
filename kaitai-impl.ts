import type { KaitaiStream } from "./kaitai-stream.ts";

/**
 * A helper class to make handwriting kaitai classes easier and safer. 
 */
export abstract class KaitaiImpl {
  constructor(
    protected _io: KaitaiStream,
    protected _parent: KaitaiImpl | null = null,
    protected _root: KaitaiImpl | null = null
  ) {
    this._root = _root ?? this;

    this.read();
  }

  abstract read(): void;
}

