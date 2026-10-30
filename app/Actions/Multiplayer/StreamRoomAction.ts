import { Action } from '@stacksjs/actions'
import { createBroadcastResponse } from '@stacksjs/realtime'
import { answer, playerOf } from '../../Multiplayer/Http'
import { RoomError } from '../../Multiplayer/Room'
import { rooms, roomChannel } from '../../Multiplayer/Rooms'

export default new Action({
  name: 'Match Stream',
  description: 'The match as a live stream of turns, over Stacks realtime',
  method: 'GET',
  async handle(request) {
    return answer(async () => {
      const player = await playerOf(request)
      const room = rooms.get(String(request.getParam('code') ?? ''))
      if (!room.seatOf(player.id)) throw new RoomError('You are not in this match.', 403)
      const code = room.code
      // Authorization is checked before subscribing, before each event and at every heartbeat.
      return createBroadcastResponse({
        channels: [roomChannel(code)],
        authorize: () => { try { return !!rooms.get(code).seatOf(player.id) } catch { return false } },
        signal: request.signal,
      })
    })
  },
})
