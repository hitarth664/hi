"use client"

import { useUsername } from "@/hooks/use-username"
import { client } from "@/lib/client"
import { useRealtime } from "@/lib/realtime-client"
import { LiveKitRoom, RoomAudioRenderer, VideoConference } from "@livekit/components-react"
import "@livekit/components-styles"
import { useMutation, useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

function formatTimeRemaining(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

const Page = () => {
  const params = useParams()
  const roomId = params.roomId as string

  const router = useRouter()

  const { username } = useUsername()
  const [input, setInput] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [copyStatus, setCopyStatus] = useState("COPY")
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
  const [showVideo, setShowVideo] = useState(false)
  const [videoToken, setVideoToken] = useState("")
  const [livekitUrl, setLivekitUrl] = useState("")
  const [videoError, setVideoError] = useState("")
  const [videoPending, setVideoPending] = useState(false)
  const [incomingCall, setIncomingCall] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachment, setAttachment] = useState<{
    name: string
    type: string
    dataUrl: string
  } | null>(null)
  const [attachmentError, setAttachmentError] = useState("")

  const { data: ttlData, refetch: refetchTtl } = useQuery({
    queryKey: ["ttl", roomId],
    queryFn: async () => {
      const res = await client.room.ttl.get({ query: { roomId } })
      return res.data
    },
    refetchInterval: 5000,
  })

  useEffect(() => {
    if (ttlData?.ttl === undefined) return

    const timeout = setTimeout(() => setTimeRemaining(ttlData.ttl), 0)
    return () => clearTimeout(timeout)
  }, [ttlData])

  useEffect(() => {
    if (timeRemaining === null || timeRemaining < 0) return

    if (timeRemaining === 0) {
      router.push("/?destroyed=true")
      return
    }

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [timeRemaining, router])

  const { data: messages, refetch } = useQuery({
    queryKey: ["messages", roomId],
    queryFn: async () => {
      const res = await client.messages.get({ query: { roomId } })
      return res.data
    },
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const { mutate: sendMessage, isPending } = useMutation({
    mutationFn: async ({ text, attachment }: {
      text: string
      attachment?: { name: string; type: string; dataUrl: string }
    }) => {
      await client.messages.post(
        { sender: username, text, attachment },
        { query: { roomId } },
      )

      setInput("")
      setAttachment(null)
    },
  })

  useRealtime({
    channels: [roomId],
    events: ["chat.message", "chat.destroy", "chat.member", "chat.call"],
    onData: ({ event, data }) => {
      if (event === "chat.message") {
        refetch()
      }

      if (event === "chat.member") {
        refetchTtl()
      }

      if (event === "chat.call") {
        if (data.startedBy !== username) {
          setIncomingCall(data.startedBy)
        }
      }

      if (event === "chat.destroy") {
        router.push("/?destroyed=true")
      }
    },
  })

  const { mutate: destroyRoom } = useMutation({
    mutationFn: async () => {
      await client.room.delete(null, { query: { roomId } })
    },
  })

  const copyLink = () => {
    const url = window.location.href
    navigator.clipboard.writeText(url)
    setCopyStatus("COPIED!")
    setTimeout(() => setCopyStatus("COPY"), 2000)
  }

  const selectAttachment = (file: File | undefined) => {
    setAttachmentError("")

    if (!file) return

    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setAttachmentError("Only photos and videos can be shared.")
      return
    }

    if (file.size > 8 * 1024 * 1024) {
      setAttachmentError("Attachments must be 8 MB or smaller.")
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== "string") return
      setAttachment({
        name: file.name,
        type: file.type,
        dataUrl: reader.result,
      })
    }
    reader.onerror = () => setAttachmentError("Unable to read that file.")
    reader.readAsDataURL(file)
  }

  const joinVideo = async () => {
    setVideoPending(true)
    setVideoError("")

    try {
      const response = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, participantName: username }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Unable to join the video call.")
      }

      setVideoToken(data.token)
      setLivekitUrl(data.livekitUrl)
      setShowVideo(true)
      setIncomingCall(null)
    } catch (error) {
      setVideoError(error instanceof Error ? error.message : "Unable to join the video call.")
    } finally {
      setVideoPending(false)
    }
  }

  const leaveVideo = () => {
    setShowVideo(false)
    setVideoToken("")
  }

  return (
    <main className="flex flex-col h-screen max-h-screen overflow-hidden">
      {videoError && (
        <div className="absolute left-1/2 top-20 z-50 -translate-x-1/2 border border-red-900 bg-red-950 px-4 py-3 text-xs text-red-400 shadow-xl">
          {videoError}
          <button
            onClick={() => setVideoError("")}
            className="ml-3 font-bold text-red-200 hover:text-white"
          >
            CLOSE
          </button>
        </div>
      )}

      {incomingCall && !showVideo && (
        <div className="absolute left-1/2 top-20 z-50 flex -translate-x-1/2 items-center gap-4 border border-green-800 bg-zinc-950 px-4 py-3 shadow-xl">
          <div className="text-xs">
            <span className="font-bold text-green-500">{incomingCall}</span>
            <span className="text-zinc-400"> started a video call</span>
          </div>
          <button
            onClick={joinVideo}
            disabled={videoPending}
            className="rounded bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-500 disabled:opacity-50"
          >
            {videoPending ? "JOINING..." : "JOIN CALL"}
          </button>
          <button
            onClick={() => setIncomingCall(null)}
            className="text-xs font-bold text-zinc-500 hover:text-white"
          >
            DECLINE
          </button>
        </div>
      )}

      {showVideo && videoToken && livekitUrl && (
        <div className="fixed inset-0 z-40 bg-zinc-950 p-4">
          <button
            onClick={leaveVideo}
            className="absolute right-6 top-6 z-50 rounded bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500"
          >
            LEAVE CALL
          </button>
          <LiveKitRoom
            token={videoToken}
            serverUrl={livekitUrl}
            connect
            video
            audio
            onDisconnected={leaveVideo}
            data-lk-theme="default"
            className="h-full"
          >
            <VideoConference />
            <RoomAudioRenderer />
          </LiveKitRoom>
        </div>
      )}

      <header className="border-b border-zinc-800 p-4 flex items-center justify-between bg-zinc-900/30">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <span className="text-xs text-zinc-500 uppercase">Room ID</span>
            <div className="flex items-center gap-10">
              <span className="font-bold text-green-500 truncate">{roomId.slice(0,10) + "..."}</span>
              <button
                onClick={copyLink}
                className="text-[10px] bg-zinc-800 hover:bg-zinc-700 px-2 py-0.5 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {copyStatus}
              </button>
            </div>
          </div>

          <div className="h-8 w-px bg-zinc-800" />

          <div className="flex flex-col">
            <span className="text-xs text-zinc-500 uppercase">Self-Destruct</span>
            <span
              className={`text-sm font-bold flex items-center gap-2 ${
                timeRemaining !== null && timeRemaining < 60
                  ? "text-red-500"
                  : "text-amber-500"
              }`}
            >
              {timeRemaining !== null ? formatTimeRemaining(timeRemaining) : "--:--"}
            </span>
          </div>

          <div className="h-8 w-px bg-zinc-800" />

          <div className="flex flex-col">
            <span className="text-xs text-zinc-500 uppercase">Members</span>
            <span className="text-sm font-bold text-zinc-300">
              {ttlData?.participants ?? 1}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={joinVideo}
            disabled={videoPending}
            className="text-xs bg-green-600 hover:bg-green-500 px-3 py-1.5 rounded text-white font-bold transition-all disabled:opacity-50"
          >
            {videoPending ? "CONNECTING..." : "JOIN VIDEO"}
          </button>

          <button
            onClick={() => destroyRoom()}
            className="text-xs bg-zinc-800 hover:bg-red-600 px-3 py-1.5 rounded text-zinc-400 hover:text-white font-bold transition-all group flex items-center gap-2 disabled:opacity-50"
          >
            <span className="group-hover:animate-pulse">💣</span>
            DESTROY NOW
          </button>
        </div>
      </header>

      {/* MESSAGES */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {messages?.messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-600 text-sm font-mono">
              No messages yet, start the conversation.
            </p>
          </div>
        )}

        {messages?.messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.sender === username ? "items-end" : "items-start"
            }`}
          >
            <div className="max-w-[80%] group">
              <div className="flex items-baseline gap-3 mb-1">
                <span
                  className={`text-xs font-bold ${
                    msg.sender === username ? "text-green-500" : "text-blue-500"
                  }`}
                >
                  {msg.sender === username ? "YOU" : msg.sender}
                </span>

                <span className="text-[10px] text-zinc-600">
                  {format(msg.timestamp, "HH:mm")}
                </span>
              </div>

              <p className="text-sm text-zinc-300 leading-relaxed break-all">
                {msg.text}
              </p>

              {msg.attachment?.type.startsWith("image/") && (
                <img
                  src={msg.attachment.dataUrl}
                  alt={msg.attachment.name}
                  className="mt-2 max-h-80 max-w-full rounded border border-zinc-800 object-contain"
                />
              )}

              {msg.attachment?.type.startsWith("video/") && (
                <video
                  src={msg.attachment.dataUrl}
                  controls
                  preload="metadata"
                  className="mt-2 max-h-80 max-w-full rounded border border-zinc-800"
                />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-zinc-800 bg-zinc-900/30">
        {attachmentError && (
          <p className="mb-2 text-xs text-red-400">{attachmentError}</p>
        )}

        {attachment && (
          <div className="mb-3 flex items-center gap-3 border border-zinc-800 bg-black p-2">
            {attachment.type.startsWith("image/") ? (
              <img
                src={attachment.dataUrl}
                alt={attachment.name}
                className="h-16 w-16 rounded object-cover"
              />
            ) : (
              <video
                src={attachment.dataUrl}
                muted
                className="h-16 w-16 rounded object-cover"
              />
            )}
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
              {attachment.name}
            </span>
            <button
              onClick={() => setAttachment(null)}
              className="text-xs font-bold text-zinc-500 hover:text-white"
            >
              REMOVE
            </button>
          </div>
        )}

        <div className="flex gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(event) => {
              selectAttachment(event.target.files?.[0])
              event.target.value = ""
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="border border-zinc-800 bg-zinc-900 px-4 text-lg text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            aria-label="Add photo or video"
          >
            +
          </button>

          <div className="flex-1 relative group">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-green-500 animate-pulse">
              {">"}
            </span>
            <input
              autoFocus
              type="text"
              value={input}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (input.trim() || attachment)) {
                  sendMessage({ text: input.trim(), attachment: attachment ?? undefined })
                  inputRef.current?.focus()
                }
              }}
              placeholder="Type message..."
              onChange={(e) => setInput(e.target.value)}
              className="w-full bg-black border border-zinc-800 focus:border-zinc-700 focus:outline-none transition-colors text-zinc-100 placeholder:text-zinc-700 py-3 pl-8 pr-4 text-sm"
            />
          </div>

          <button
            onClick={() => {
              sendMessage({ text: input.trim(), attachment: attachment ?? undefined })
              inputRef.current?.focus()
            }}
            disabled={(!input.trim() && !attachment) || isPending}
            className="bg-zinc-800 text-zinc-400 px-6 text-sm font-bold hover:text-zinc-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            SEND
          </button>
        </div>
      </div>
    </main>
  )
}

export default Page

