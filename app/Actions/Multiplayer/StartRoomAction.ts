import { Action } from '@stacksjs/actions'
import { answer, playerOf } from '../../Multiplayer/Http'
import { rooms } from '../../Multiplayer/Rooms'

export default new Action({
  name: 'Start Match',
  description: 'Start a match once both seats are taken. Only the host may.',
  method: 'POST',
  async handle(request) {
    return answer(async () => {
      const player = await playerOf(request)
      const room = rooms.start(String(request.getParam('code') ?? ''), player.id)
      return { ...room.describe(), you: room.seatOf(player.id)!.player }
    })
  },
})
