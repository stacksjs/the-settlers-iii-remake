# Original manual evidence snapshot

The issue catalog pins original manual source files to [the preserved source revision 8426388935b436e65b0697ac401c4247ab097364](https://github.com/JakeSteam/settlers/tree/8426388935b436e65b0697ac401c4247ab097364). The [rendered manual](https://settlers.jakelee.co.uk/en/main.htm) remains convenient for reading. Raw file SHA-256 values were verified on 2026-10-21:

| File under en/ | SHA-256 |
|---|---|
| changes/changes.htm | 4f9f74e5ca6b57f9af15c23769daa9639307b657a6dee17c4147e65705ae3a74 |
| ec_basic/basics.htm | a6a10487a4818f87e7d622d730190cb2077b12dcab99852d428f149c6d53c899 |
| ec_build/building.htm | 10dcbad8d7c02a7873b263f1db81e7561368467f429c4b6b6113758122d65a9e |
| ec_jobs/jops.htm | ae9aa52d18a480546cc36be74f10c61efd2e89dd24a78b6db98bb2d6b5b988f0 |
| in_menu/menu.htm | 6823c1be372ce3c6905d09753d867ecd637e6cd2c5bfa3e26ea5fd161be516bb |
| ec_trade/trade.htm | 9f9a5facf26e092b0e8e31f0c50ba9615f45b4c43a934d375a424d427efe888f |
| military/military.htm | 1609d51c59a335194f10be6d2cf51c612f3b1fe28ae507c5e2a8aafa922911f7 |
| in_prep/prepare.htm | a817e89d071e8daa146f52225d3d4dd5f7566ae92c5cb2731902cff5c2b61462 |

The S3-001 documentary delta ledger also pins `tips/main.htm` at the same archive revision, SHA-256 `ef7568b47e16897c0d4a80422650d4b1e4dc8c98391654f30ab7e1599e970a17`. Its Mission CD/Amazon CD change section supplies explicit documentary differences without identifying a retail executable or exact patch. `bun run fidelity:verify` rechecks the sources and section anchors used by that ledger.

This snapshot is a preserved revised manual. It does not establish that every statement applies unchanged to every original release. S3-001 establishes the edition/revision matrix, S3-002 supplies repeatable observations, and S3-006/007 reconcile actual content identifiers and rules. Unknown numeric values, mission details, and asset rights remain unverified.

The [campaign index](https://strategywiki.org/wiki/The_Settlers_III/Table_of_Contents) is secondary evidence for provisional mission slots only. Each campaign issue contains a ledger with unchecked original identifier, starting-state, objectives, media, save/restore, outcome and progression evidence. Add or revise rows when original data establishes a different inventory.
