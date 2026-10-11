# UI reference screens

These are the target designs for the registry app and the verifier, exported from the "ProofChain UI Screens" canvas (open the canvas link Archit shared to see them rendered).

They are **reference only**: the files use the design canvas's own markup (`<x-dc>`, `<sc-for>`, `{{holes}}`) and do not run in our apps. Rebuild them in React + Tailwind using the components in `CLAUDE.md` "UI guidelines". Take colours, spacing, hierarchy, copy and states from here; take data shapes from the API contract in `CLAUDE.md`.

| File | Screen | App route | Owner |
| --- | --- | --- | --- |
| `Main.dc.html` | Upload | web `/` | Mahendra |
| `Confirm.dc.html` | Confirm metadata | web `/confirm/:recordId` | Mahendra |
| `Records.dc.html` | Records | web `/records` | Neel |
| `Batches.dc.html` | Batches | web `/batches` | Neel |
| `Audit.dc.html` | Audit + activity log | web `/audit` | Neel |
| `Demo.dc.html` | Tamper demo | web `/demo` | Neel |
| `Verifier.dc.html` | Verifier, genuine document (VALID) | verifier `/` | Neel |
| `VerifierForged.dc.html` | Verifier, forged proof (ROOT_MISMATCH) | verifier `/` | Neel |

**Shared look:** IBM Plex Sans for text, IBM Plex Mono for hashes, IDs and addresses; slate-50 page, white cards with slate-200 borders and 12 px radius; indigo-600 for primary actions; emerald for pass, rose for fail, amber for pending, slate for skipped.

**Demo data used in every screen** (keep it consistent with `samples/` and the seed script): BATCH-0001 = REC-000001…000005, BATCH-0002 = REC-000006…000009, REC-000010…000012 pending, REC-000013…000014 draft. REC-000008 is the record shown in both verifier states; REC-000006 is the tamper target. All names and documents are fictional.
