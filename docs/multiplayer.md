# Online duels

Two players, two Roman settlements on one generated landscape, played through Stacks realtime. The server owns the match; browsers replay it.

## Flow

1. A signed-in player opens `/multiplayer` and hosts a match. The server creates a room and returns a five-letter code.
2. A second signed-in player joins with the code or the invite link. Seats are assigned by the server: the host holds player 1 (west), the guest player 2 (east). A third player is refused.
3. The host starts the match once both seats are taken. Both browsers load `/play?room=CODE`.

## Protocol

Everything is in `app/Multiplayer/` and `app/Actions/Multiplayer/`, mounted at `/api/multiplayer` behind the `auth` middleware by `routes/multiplayer.ts`.

| Route | Purpose |
|---|---|
| `POST /rooms` | Host a match |
| `POST /rooms/:code/join` | Take the free seat (joining twice is the same seat) |
| `POST /rooms/:code/leave` | A guest frees the seat; the host closes the lobby |
| `POST /rooms/:code/start` | Host only, with two seats taken |
| `POST /rooms/:code/orders` | Queue an order for the next turn |
| `GET /rooms/:code/snapshot` | The whole world at the current turn |
| `GET /rooms/:code/stream` | The match as a live stream (SSE) from `createBroadcastResponse` |

The room runs the authoritative `Session` (`resources/game/engine`). Every 250 ms it stamps the queued orders with the seat's player, the next sequence number and the current tick, enqueues them, advances five ticks and publishes `{ n, from, ticks, commands, checksum }` on `private-room.CODE` with `emit()`. The browser (`resources/game/multiplayer.ts`, `controller.ts`) opens the stream first, then reads the snapshot, so no turn falls between the two. It replays each turn on its own copy at the frame rate, compares the checksum after every turn, and on a gap or a mismatch fetches a fresh snapshot and carries on.

Authority: the seat decides whose order it is; `player`, `tick`, `seq` and `type` in a request body are ignored; orders are size-limited and rate-limited per turn; the engine validates cost, ownership and placement when the order runs, and every copy reaches the same refusal. A client on other game rules refuses the snapshot with a clear message instead of playing a different game.

## Checks

- `tests/unit/multiplayer-room.test.ts`: authority, determinism against a replaying mirror, refusals, flooding, history, the registry's publishing, leaving, rules mismatch and the end of a match.
- `tests/browser/multiplayer.ts`: two signed-in browsers host, join (and leave and rejoin), start, build, verify at least 20 turns each with no resync, recover from a dropped connection, reload, and end in victory and defeat.

## Limits

- Both clients hold the whole world, so a modified client could read the map beyond its fog. Visibility-filtered updates (issue S3-094) are not done.
- Matches live in one server process, which is the Stacks realtime contract; a restart ends them. Scaling out needs an application-provided fan-out.
- Two seats, no computer fill-in, no spectators, no chat, and a player who leaves a running match keeps their seat and their settlement keeps running.
