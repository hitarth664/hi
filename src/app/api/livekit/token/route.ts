import { redis } from "@/lib/redis"
import { realtime } from "@/lib/realtime"
import { AccessToken } from "livekit-server-sdk"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  const livekitUrl = process.env.LIVEKIT_URL

  if (!apiKey || !apiSecret || !livekitUrl) {
    return NextResponse.json(
      { error: "LiveKit is not configured. Add your LiveKit credentials to .env." },
      { status: 503 },
    )
  }

  const body = await request.json()
  const roomId = typeof body.roomId === "string" ? body.roomId.trim() : ""
  const participantName =
    typeof body.participantName === "string"
      ? body.participantName.trim().slice(0, 100)
      : ""

  if (!roomId || !participantName) {
    return NextResponse.json(
      { error: "Room and participant are required." },
      { status: 400 },
    )
  }

  const cookieStore = await cookies()
  const authToken = cookieStore.get("x-auth-token")?.value
  const connected = await redis.hget<string[]>(`meta:${roomId}`, "connected")

  if (!authToken || !connected?.includes(authToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const accessToken = new AccessToken(apiKey, apiSecret, {
    identity: authToken,
    name: participantName,
  })

  accessToken.addGrant({
    roomJoin: true,
    room: roomId,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  })

  await realtime.channel(roomId).emit("chat.call", {
    startedBy: participantName,
  })

  return NextResponse.json({
    token: await accessToken.toJwt(),
    livekitUrl,
  })
}
