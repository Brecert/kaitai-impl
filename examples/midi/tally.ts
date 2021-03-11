import { KaitaiStream } from "../../mod.ts";

import { StandardMidiFile } from "./standard_midi_file.ts";

const data = await fetch(
  "https://upload.wikimedia.org/wikipedia/commons/e/e4/Ab_jazz_minor_scale_%28G7%29_resolving_to_C.mid",
);

const stream = new KaitaiStream(await data.arrayBuffer());
const midi = new StandardMidiFile(stream);

const count: Map<number, number> = new Map();

for (const track of midi) {
  for (const event of track.events) {
    count.set(event.eventType(), (count.get(event.eventType()) ?? 0) + 1);
  }
}

const eventTally = Object.fromEntries(
  [...count].sort((a, b) => a[0] - b[0]).map((
    [k, v],
  ) => [`0x${k.toString(16).padStart(2, "0")}`, v]),
);

console.log(eventTally);
