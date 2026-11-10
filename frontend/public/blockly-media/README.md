# Blockly media

Copied unchanged from `node_modules/blockly/media/` (Blockly 13.4.0, Apache-2.0), so the block
editor never fetches its icons from static.blockly.com: the zoom and trash controls (`sprites.svg`),
the comment and mutator icons, and the toolbox cursors work on a LAN with no internet.

Set as Blockly's `media` option in `src/workspace/blocks/BlockEditor.tsx`. Sounds are off, so no
audio files are needed. After a Blockly upgrade, copy these files again from the new version.
