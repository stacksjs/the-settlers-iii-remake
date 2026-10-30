import { Action } from '@stacksjs/actions'
import { answer, playerOf } from '../../Multiplayer/Http'
import { rooms } from '../../Multiplayer/Rooms'

export default new Action({
  name: 'Leave Match',
  description: 'Leave a lobby: a guest frees the seat, the host closes the match',
  method: 'POST',
  async handle(request) {
    return answer(async () => {
      const player = await playerOf(request)
      rooms.leave(String(request.getParam('code') ?? ''), player.id)
      return { left: true }
    })
  },
})
