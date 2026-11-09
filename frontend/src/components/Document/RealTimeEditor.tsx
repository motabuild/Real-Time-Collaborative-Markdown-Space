import debounce from "lodash.debounce"
import {
  Eraser,
  FileCode2,
  TerminalIcon,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"

const SAVE_DEBOUNCE_MS = 2000

/** Matches canonical UUIDs, the only ids the REST API accepts. */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type LogLevel = "sys" | "ws" | "err" | "save"

interface LogEntry {
  id: number
  timestamp: string
  level: LogLevel
  message: string
}

interface PeerMessage {
  event?: string
  content?: string
  senderId?: string
  meta?: { active_peers?: number }
}

const levelStyles: Record<LogLevel, { tag: string; text: string }> = {
  sys: { tag: "text-cyan-300", text: "text-cyan-400" },
  ws: { tag: "text-teal-400", text: "text-teal-300" },
  err: { tag: "text-rose-300", text: "text-rose-400" },
  save: { tag: "text-emerald-300", text: "text-emerald-400" },
}

const levelTags: Record<LogLevel, string> = {
  sys: "[SYS]",
  ws: "[WS]",
  err: "[ERR]",
  save: "[DB]",
}

function getTimestamp(): string {
  return new Date().toTimeString().split(" ")[0]
}

/**
 * Derive the WebSocket base URL from the configured HTTP API URL by swapping
 * the scheme: http -> ws, https -> wss.
 */
function getWsBaseUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:8000"
  return apiUrl
    .replace(/^http(s?):/, (_match: string, secure: string) =>
      secure ? "wss:" : "ws:",
    )
    .replace(/\/$/, "")
}

function getApiBaseUrl(): string {
  return (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(
    /\/$/,
    "",
  )
}

interface RealTimeEditorProps {
  documentId: string
}

/** Module-level counter: guarantees unique log keys across StrictMode remounts. */
let globalLogId = 0

function RealTimeEditor({ documentId }: RealTimeEditorProps) {
  const [content, setContent] = useState("")
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [activePeers, setActivePeers] = useState(0)
  const [connected, setConnected] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const terminalRef = useRef<HTMLDivElement | null>(null)
  // Identifies this client so echoed broadcasts from our own socket are
  // ignored rather than clobbering the caret mid-typing.
  const senderIdRef = useRef(
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  )

  const pushLog = useCallback((level: LogLevel, message: string) => {
    globalLogId += 1
    setLogs((previous) => [
      ...previous,
      { id: globalLogId, timestamp: getTimestamp(), level, message },
    ])
  }, [])

  // Persist the latest content to PostgreSQL.
  const saveContent = useCallback(
    async (text: string) => {
      // The REST route requires a real UUID. Rooms may be opened with arbitrary
      // ids (e.g. "/documents/123" for demos), so skip persistence gracefully
      // instead of firing a request the API will reject with 422.
      if (!UUID_PATTERN.test(documentId)) {
        pushLog(
          "sys",
          `Skipping persist: "${documentId}" is not a persisted document id`,
        )
        return
      }

      try {
        const response = await fetch(
          `${getApiBaseUrl()}/api/v1/documents/${documentId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: text }),
          },
        )
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        pushLog(
          "save",
          `Persisted ${text.length} chars to PostgreSQL -> /documents/${documentId}`,
        )
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        pushLog("err", `Persist failed: ${detail}`)
      }
    },
    [documentId, pushLog],
  )

  const debouncedSaveRef = useRef<ReturnType<typeof debounce> | null>(null)

  // (Re)build the debounced saver whenever saveContent changes.
  useEffect(() => {
    debouncedSaveRef.current = debounce(saveContent, SAVE_DEBOUNCE_MS)
    return () => {
      debouncedSaveRef.current?.cancel()
    }
  }, [saveContent])

  // Connect the WebSocket for the lifetime of the component.
  // Guards against React StrictMode's intentional double-mount, which would
  // otherwise push the startup logs (and open a second socket) twice.
  const didInitRef = useRef(false)

  useEffect(() => {
    const url = `${getWsBaseUrl()}/api/v1/documents/${documentId}/ws`

    if (!didInitRef.current) {
      didInitRef.current = true
      pushLog("sys", "Initializing MotaBuild Labs core sync pipeline...")
      pushLog("sys", `Opening socket ${url}`)
    }

    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      pushLog("err", `Unable to open socket: ${detail}`)
      return
    }
    wsRef.current = socket

    socket.onopen = () => {
      setConnected(true)
      pushLog("ws", `Connected to Room ${documentId}`)
    }

    socket.onmessage = (event: MessageEvent<string>) => {
      let payload: PeerMessage
      try {
        payload = JSON.parse(event.data) as PeerMessage
      } catch {
        pushLog("err", `Malformed frame: ${String(event.data).slice(0, 60)}`)
        return
      }

      const peers = payload.meta?.active_peers
      if (typeof peers === "number") {
        setActivePeers(peers)
      }

      // Ignore our own echoes so remote updates never fight the local caret.
      if (payload.senderId === senderIdRef.current) {
        pushLog("ws", `Echo acknowledged -> Active Peers: ${peers ?? 0}`)
        return
      }

      if (payload.event === "system") {
        pushLog(
          "sys",
          `${payload.content ?? "Peer event"} -> Active Peers: ${peers ?? 0}`,
        )
        return
      }

      if (typeof payload.content === "string") {
        setContent(payload.content)
        pushLog("ws", `Broadcast Delta received -> Active Peers: ${peers ?? 0}`)
      }
    }

    socket.onerror = () => {
      pushLog("err", `Socket error on Room ${documentId}`)
    }

    socket.onclose = () => {
      setConnected(false)
      pushLog("sys", `Socket closed for Room ${documentId}`)
    }

    return () => {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.close()
      wsRef.current = null
    }
  }, [documentId, pushLog])

  // Auto-scroll the terminal to the newest entry.
  useEffect(() => {
    const node = terminalRef.current
    if (node) {
      node.scrollTop = node.scrollHeight
    }
  }, [])

  const handleChange = (newText: string) => {
    // 1. Instant local update.
    setContent(newText)

    // 2. Instant broadcast to peers.
    const socket = wsRef.current
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          event: "edit",
          content: newText,
          senderId: senderIdRef.current,
        }),
      )
    }

    // 3. Outbound telemetry.
    pushLog("sys", `Syncing delta... (${newText.length} chars)`)

    // 4. Debounced persistence.
    debouncedSaveRef.current?.(newText)
  }

  const charCount = content.length
  const wordCount = useMemo(
    () => content.trim().split(/\s+/).filter(Boolean).length,
    [content],
  )

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-zinc-800/70 bg-zinc-950 text-zinc-300">
      {/* Header strip */}
      <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-zinc-900 bg-zinc-950/90 px-5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-500/30 bg-zinc-900 shadow-[0_0_12px_rgba(6,182,212,0.15)]">
            <FileCode2 className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="flex items-baseline gap-1.5 tracking-tight">
            <span className="font-bold tracking-tight text-cyan-500">
              MotaBuild
            </span>
            <span className="text-sm font-medium text-zinc-400">Labs</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-zinc-800/60 bg-zinc-900/60 px-3 py-1 font-mono text-xs text-zinc-400">
            <FileCode2 className="h-3.5 w-3.5 text-cyan-400" />
            <span className="font-medium text-zinc-200">
              Room {documentId.slice(0, 8)}
            </span>
          </div>
          <div
            className="flex items-center gap-1.5 rounded-full border border-zinc-800/80 bg-zinc-900/80 px-3 py-1 text-xs"
            data-testid="active-peers"
          >
            {connected ? (
              <Wifi className="h-3.5 w-3.5 text-teal-400" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-rose-400" />
            )}
            <Users className="h-3 w-3 text-zinc-500" />
            <span className="font-mono font-semibold text-cyan-500">
              {activePeers}
            </span>
            <span className="text-zinc-500">active</span>
          </div>
        </div>
      </header>

      {/* Editor + Preview */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section className="relative flex min-w-0 flex-1 flex-col border-b border-zinc-900/90 bg-zinc-900/40 md:border-b-0 md:border-r">
          <div className="flex h-9 select-none items-center justify-between border-b border-zinc-900/80 bg-zinc-950/40 px-4 font-mono text-xs text-zinc-400">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-cyan-500/80" />
              <span className="font-semibold uppercase tracking-wider text-zinc-300">
                Editor
              </span>
              <span className="text-zinc-600">/</span>
              <span className="text-zinc-500">Markdown Source</span>
            </div>
            <div className="flex items-center gap-3 text-zinc-500">
              <span>{charCount} chars</span>
              <span>•</span>
              <span>{wordCount} words</span>
              <span>•</span>
              <span className="font-medium text-cyan-500/90">UTF-8</span>
            </div>
          </div>

          <div className="relative flex-1 p-3">
            <textarea
              value={content}
              onChange={(event) => handleChange(event.target.value)}
              spellCheck={false}
              placeholder="Start typing markdown here..."
              aria-label="Markdown editor"
              className="h-72 w-full resize-none overflow-y-auto rounded-lg border border-zinc-800/40 bg-zinc-900/60 p-4 font-mono text-sm leading-relaxed text-zinc-200 shadow-inner transition-all placeholder:text-zinc-600 focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20 focus:outline-none md:h-96"
            />
          </div>
        </section>

        <section className="relative flex min-w-0 flex-1 flex-col bg-zinc-900/20">
          <div className="flex h-9 select-none items-center justify-between border-b border-zinc-900/80 bg-zinc-950/40 px-4 font-mono text-xs text-zinc-400">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-teal-400/80" />
              <span className="font-semibold uppercase tracking-wider text-zinc-300">
                Live Preview
              </span>
              <span className="text-zinc-600">/</span>
              <span className="text-zinc-500">Formatted DOM</span>
            </div>
            <div className="flex items-center gap-1.5 text-zinc-500">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
              Real-time sync
            </div>
          </div>

          <div className="flex-1 overflow-hidden p-3">
            <div className="prose-mota h-72 w-full overflow-y-auto rounded-lg border border-zinc-800/40 bg-zinc-800/25 p-6 shadow-sm md:h-96">
              <ReactMarkdown>
                {content || "*No content to preview...*"}
              </ReactMarkdown>
            </div>
          </div>
        </section>
      </div>

      {/* Flex Terminal */}
      <section className="z-20 flex h-[210px] flex-shrink-0 flex-col border-t border-zinc-900 bg-black shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_-4px_20px_-2px_rgba(6,182,212,0.08)]">
        <div className="flex h-8 select-none items-center justify-between border-b border-zinc-900 bg-zinc-950 px-4 font-mono text-xs">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-rose-500/70" />
              <span className="h-2 w-2 rounded-full bg-amber-500/70" />
              <span className="h-2 w-2 rounded-full bg-emerald-500/70" />
            </div>
            <TerminalIcon className="h-3.5 w-3.5 text-cyan-400" />
            <span className="font-semibold tracking-tight text-zinc-200">
              Live Server Telemetry &amp; Socket Logs
            </span>
          </div>

          <div className="flex items-center gap-4 text-[11px] text-zinc-500">
            <div className="hidden items-center gap-2 lg:flex">
              <span className="text-zinc-600">CHANNEL:</span>
              <span className="max-w-[420px] truncate font-semibold text-cyan-400">
                {getWsBaseUrl()}/api/v1/documents/{documentId.slice(0, 8)}/ws
              </span>
            </div>
            <button
              type="button"
              onClick={() => setLogs([])}
              className="flex items-center gap-1 text-zinc-500 transition-colors hover:text-zinc-300"
            >
              <Eraser className="h-3 w-3" /> Clear
            </button>
          </div>
        </div>

        <div
          ref={terminalRef}
          data-testid="terminal"
          className="flex-1 space-y-1 overflow-y-auto bg-black p-3.5 font-mono text-sm leading-relaxed text-zinc-300"
        >
          {logs.length === 0 ? (
            <div className="select-none pb-1 font-sans text-[11px] text-zinc-600">
              --- SESSION INITIATED ---
            </div>
          ) : (
            logs.map((entry) => (
              <div
                key={entry.id}
                className={`flex items-start gap-2 ${levelStyles[entry.level].text}`}
              >
                <span className="select-none text-zinc-600">
                  [{entry.timestamp}]
                </span>
                <span className="break-all">
                  <strong className={levelStyles[entry.level].tag}>
                    {levelTags[entry.level]}
                  </strong>{" "}
                  {entry.message}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

export default RealTimeEditor
export type { RealTimeEditorProps }
