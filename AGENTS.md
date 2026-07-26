# Project Instructions

**Primary workflow:** [REGLEMENT_WORK.md](./REGLEMENT_WORK.md) — read it first.

All AI agents (Grok, Claude, Cursor, Copilot, Codex, etc.) must follow it:

- maximize token/command/read economy **without** losing quality;
- one verified step at a time;
- no broad file reads, no home/`find` scans, no log dumps;
- no Electron/UI rewrites without a concrete bug and permission;
- short answers: done → result → more needed yes/no;
- before first **write**: minimal inspect + recoverable checkpoint;
- after UI/code change: typecheck / dev checks as in the reglement.

If a global agent protocol conflicts on *exploration volume or verbosity*, this
reglement wins. Safety (checkpoint, no destructive git, evidence) stays.
