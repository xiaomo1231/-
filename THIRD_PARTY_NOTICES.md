# Third-party notices

## Groove MIDI Dataset

The drum templates in `src/songs/drumTemplates.json` are derived from the Groove MIDI Dataset (GMD), created by Google LLC (Magenta project), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Citation: Gillick, Roberts, Engel, Eck and Bamman (2019), "Learning to Groove with Inverse Sequence Transformations", ICML. The templates were made by reading the dataset's MIDI files, quantizing their drum hits to a sixteenth-note grid, and selecting recurring one- and two-bar patterns and fills (`scripts/build-drum-templates.mjs`); some hand-written basic patterns are added. The dataset archive itself is not redistributed in this repository.
