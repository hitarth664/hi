import { NextRequest, NextResponse } from "next/server"
import { redis } from "./lib/redis"
import { nanoid } from "nanoid"
import { realtime } from "./lib/realtime"

export const proxy = async (req: NextRequest) => {
  const pathname = req.nextUrl.pathname
  const MAX_ROOM_PARTICIPANTS = 50

  const roomMatch = pathname.match(/^\/room\/([^/]+)$/)
  if (!roomMatch) return NextResponse.redirect(new URL("/", req.url))

  const roomId = roomMatch[1]

  const meta = await redis.hgetall<{ connected: string[]; createdAt: number }>(
    `meta:${roomId}`
  )

  if (!meta) {
    return NextResponse.redirect(new URL("/?error=room-not-found", req.url))
  }

  const existingToken = req.cookies.get("x-auth-token")?.value

  // USER IS ALLOWED TO JOIN ROOM
  if (existingToken && meta.connected.includes(existingToken)) {
    return NextResponse.next()
  }

  // USER IS NOT ALLOWED TO JOIN
  if (meta.connected.length >= MAX_ROOM_PARTICIPANTS) {
    return NextResponse.redirect(new URL("/?error=room-full", req.url))
  }

  const response = NextResponse.next()

  const token = nanoid()

  response.cookies.set("x-auth-token", token, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  })

  const participants = [...meta.connected, token]

  await redis.hset(`meta:${roomId}`, {
    connected: participants,
  })

  await realtime.channel(roomId).emit("chat.member", {
    participants: participants.length,
  })

  return response
}

export const config = {
  matcher: "/room/:path*",
}
