import { route } from '@stacksjs/router'

/**
 * Online matches. Every route needs a signed-in player; the room decides which
 * seat is theirs. Mounted under `/api/multiplayer` by `app/Routes.ts`.
 */
route.post('/rooms', 'Actions/Multiplayer/CreateRoomAction')
route.get('/rooms/:code', 'Actions/Multiplayer/ShowRoomAction')
route.post('/rooms/:code/join', 'Actions/Multiplayer/JoinRoomAction')
route.post('/rooms/:code/leave', 'Actions/Multiplayer/LeaveRoomAction')
route.post('/rooms/:code/start', 'Actions/Multiplayer/StartRoomAction')
route.post('/rooms/:code/orders', 'Actions/Multiplayer/SendOrderAction')
route.get('/rooms/:code/snapshot', 'Actions/Multiplayer/SnapshotAction')
route.get('/rooms/:code/stream', 'Actions/Multiplayer/StreamRoomAction')
