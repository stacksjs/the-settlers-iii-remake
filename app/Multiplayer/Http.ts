import type { RequestInstance } from '@stacksjs/types'
import { response } from '@stacksjs/router'
import { RoomError } from './Room'

export interface Player { id: number, name: string }

/** The signed-in player making this request, from the session and never from the body. */
export async function playerOf(request: RequestInstance): Promise<Player> {
  const user = await request.user()
  if (!user) throw new RoomError('Sign in to play online.', 401)
  const name = String((user as { name?: unknown }).name ?? '').trim() || 'Player'
  return { id: Number(user.id), name }
}

/** Runs a handler and turns a room's refusal into the HTTP answer it carries; anything else is a real fault. */
export async function answer(run: () => Promise<unknown> | unknown): Promise<Response> {
  try {
    const body = await run()
    return body instanceof Response ? body : response.json(body as object)
  }
  catch (error) {
    if (error instanceof RoomError) return response.json({ message: error.message }, { status: error.status })
    throw error
  }
}
