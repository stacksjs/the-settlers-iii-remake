import { Action } from '@stacksjs/actions'
import { answer, playerOf } from '../../Multiplayer/Http'
import { rooms } from '../../Multiplayer/Rooms'

export default new Action({
  name: 'Join Match',
  description: 'Take the free seat in a match by its code',
  method: 'POST',
  async handle(request) {
    return answer(async () => {
      const player = await playerOf(request)
      const room = rooms.join(String(request.getParam('code') ?? ''), player)
      return { ...room.describe(), you: room.seatOf(player.id)!.player }
    })
  },
})
