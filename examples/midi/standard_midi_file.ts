import { KaitaiImpl, KaitaiStream } from "../../mod.ts";
import { VlqBase128Be } from "./variable_length_quantity.ts";

export class StandardMidiFile extends KaitaiImpl {
  hdr!: Header;
  tracks!: Array<Track>;

  read() {
    this.hdr = new Header(this._io, this, this._root);
    this.tracks = new Array(this.hdr.qtyTracks);
    for (let i = 0; i < this.hdr.qtyTracks; i++) {
      this.tracks[i] = new Track(this._io, this, this._root);
    }
  }

  *[Symbol.iterator]() {
    for (let i = 0; i < this.tracks.length; i++) {
      yield this.tracks[i];
    }
    return this.tracks;
  }
}

export class TrackEvents extends KaitaiImpl {
  event!: TrackEvent[];

  read() {
    this.event = [];
    while (!this._io.isEof()) {
      this.event.push(new TrackEvent(this._io, this, this._root));
    }
  }

  *[Symbol.iterator]() {
    for (let i = 0; i < this.event.length; i++) {
      yield this.event[i];
    }
    return this.event;
  }
}

type EventBodyType =
  | PitchBendEvent
  | NoteOnEvent
  | ChannelPressureEvent
  | ProgramChangeEvent
  | PolyphonicPressureEvent
  | ControllerEvent
  | NoteOffEvent;

export enum EventType {
  NoteOff = 128,
  NoteOn = 144,
  Controller = 176,
  PolyphonicPressure = 160,
  ProgramChange = 192,
  ChannelPressure = 208,
  PitchBend = 224,
}

export class TrackEvent extends KaitaiImpl {
  vTime!: VlqBase128Be;
  eventHeader!: number;
  metaEventBody?: MetaEventBody;
  sysexBody?: SysexEventBody;
  eventBody?: EventBodyType;

  read() {
    this.vTime = new VlqBase128Be(this._io, this, null);
    this.eventHeader = this._io.readU1();
    if (this.eventHeader == 255) {
      this.metaEventBody = new MetaEventBody(this._io, this, this._root);
    }
    if (this.eventHeader == 240) {
      this.sysexBody = new SysexEventBody(this._io, this, this._root);
    }
    switch (this.eventType()) {
      case EventType.PitchBend:
        this.eventBody = new PitchBendEvent(this._io, this, this._root);
        break;
      case EventType.NoteOn:
        this.eventBody = new NoteOnEvent(this._io, this, this._root);
        break;
      case EventType.ChannelPressure:
        this.eventBody = new ChannelPressureEvent(this._io, this, this._root);
        break;
      case EventType.ProgramChange:
        this.eventBody = new ProgramChangeEvent(this._io, this, this._root);
        break;
      case EventType.PolyphonicPressure:
        this.eventBody = new PolyphonicPressureEvent(
          this._io,
          this,
          this._root,
        );
        break;
      case EventType.Controller:
        this.eventBody = new ControllerEvent(this._io, this, this._root);
        break;
      case EventType.NoteOff:
        this.eventBody = new NoteOffEvent(this._io, this, this._root);
        break;
    }
  }

  eventType() {
    return this.eventHeader & 240;
  }

  channel() {
    if (this.eventType() != 240) {
      return (this.eventHeader & 15);
    }
  }
}

export class PitchBendEvent extends KaitaiImpl {
  eventType = EventType.PitchBend;

  #bendValue?: number;
  #adjBendValue?: number;

  b1!: number;
  b2!: number;

  read() {
    this.b1 = this._io.readU1();
    this.b2 = this._io.readU1();
  }

  get bendValue() {
    if (this.#bendValue !== undefined) {
      return this.#bendValue;
    }
    this.#bendValue = (((this.b2 << 7) + this.b1) - 16384);
    return this.#bendValue;
  }

  get adjBendValue() {
    if (this.#adjBendValue !== undefined) {
      return this.#adjBendValue;
    }
    this.#adjBendValue = (this.bendValue - 16384);
    return this.#adjBendValue;
  }
}

export class ProgramChangeEvent extends KaitaiImpl {
  eventType = EventType.ProgramChange;

  program!: number;

  read() {
    this.program = this._io.readU1();
  }
}

export class NoteOnEvent extends KaitaiImpl {
  eventType = EventType.NoteOn;

  note!: number;
  velocity!: number;

  read() {
    this.note = this._io.readU1();
    this.velocity = this._io.readU1();
  }
}

export class PolyphonicPressureEvent extends KaitaiImpl {
  eventType = EventType.PolyphonicPressure;
  note!: number;
  pressure!: number;

  read() {
    this.note = this._io.readU1();
    this.pressure = this._io.readU1();
  }
}

export class Track extends KaitaiImpl {
  _raw_events!: Uint8Array;

  magic!: Uint8Array;
  trackLength!: number;
  events!: TrackEvents;

  read() {
    this.magic = this._io.ensureFixedContents([77, 84, 114, 107]);
    this.trackLength = this._io.readU4be();
    this._raw_events = this._io.readBytes(this.trackLength);
    const rawEvents = new KaitaiStream(this._raw_events);
    this.events = new TrackEvents(rawEvents, this, this._root);
  }
}

export enum MetaEventType {
  SEQUENCE_NUMBER = 0x00,
  TEXT_EVENT = 0x01,
  COPYRIGHT = 0x02,
  SEQUENCE_TRACK_NAME = 0x03,
  INSTRUMENT_NAME = 0x04,
  LYRIC_TEXT = 0x05,
  MARKER_TEXT = 0x06,
  CUE_POINT = 0x07,
  PROGRAM_NAME = 0x08,
  DEVICE_NAME = 0x09,
  MIDI_CHANNEL_PREFIX_ASSIGNMENT = 32,
  END_OF_TRACK = 47,
  TEMPO = 81,
  SMPTE_OFFSET = 84,
  TIME_SIGNATURE = 88,
  KEY_SIGNATURE = 89,
  SEQUENCER_SPECIFIC_EVENT = 127,
}

export class MetaEventBody extends KaitaiImpl {
  metaType!: number;
  len!: VlqBase128Be;
  body!: Uint8Array;

  read() {
    this.metaType = this._io.readU1();
    this.len = new VlqBase128Be(this._io, this, null);
    this.body = this._io.readBytes(this.len.value);
  }
}

export class ControllerEvent extends KaitaiImpl {
  eventType = EventType.Controller;
  controller!: number;
  value!: number;

  read() {
    this.controller = this._io.readU1();
    this.value = this._io.readU1();
  }
}

export class Header extends KaitaiImpl {
  magic!: Uint8Array;
  headerLength!: number;
  format!: number;
  qtyTracks!: number;
  division!: number;

  read() {
    this.magic = this._io.ensureFixedContents([77, 84, 104, 100]);
    this.headerLength = this._io.readU4be();
    this.format = this._io.readU2be();
    this.qtyTracks = this._io.readU2be();
    this.division = this._io.readS2be();
  }
}

export class SysexEventBody extends KaitaiImpl {
  len!: VlqBase128Be;
  data!: Uint8Array;

  read() {
    this.len = new VlqBase128Be(this._io, this, null);
    this.data = this._io.readBytes(this.len.value);
  }
}

export class NoteOffEvent extends KaitaiImpl {
  eventType = EventType.NoteOff;
  note!: number;
  velocity!: number;

  read() {
    this.note = this._io.readU1();
    this.velocity = this._io.readU1();
  }
}

export class ChannelPressureEvent extends KaitaiImpl {
  eventType = EventType.ChannelPressure;
  pressure!: number;

  read() {
    this.pressure = this._io.readU1();
  }
}
