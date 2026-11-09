import { useMutation } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Loader2, Plus } from "lucide-react"

import { type DocumentCreate, DocumentsService } from "@/client"
import { Button } from "@/components/ui/button"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

export const Route = createFileRoute("/_layout/")({
  component: Dashboard,
  head: () => ({
    meta: [
      {
        title: "Dashboard - MotaBuild Labs",
      },
    ],
  }),
})

function Dashboard() {
  const { user: currentUser } = useAuth()
  const navigate = useNavigate()
  const { showErrorToast } = useCustomToast()

  const createDocumentSpace = useMutation({
    mutationFn: (data: DocumentCreate) =>
      DocumentsService.createDocument({ requestBody: data }),
    onSuccess: (created) => {
      navigate({
        to: "/documents/$documentId",
        params: { documentId: created.id },
      })
    },
    onError: handleError.bind(showErrorToast),
  })

  return (
    <div>
      <div>
        <h1 className="max-w-sm truncate text-2xl">
          Hi, {currentUser?.full_name || currentUser?.email} 👋
        </h1>
        <p className="text-muted-foreground">
          Welcome back, nice to see you again!!!
        </p>
      </div>

      {/* MotaBuild Labs experiments */}
      <section className="mt-8 rounded-lg border border-zinc-800/70 bg-zinc-950 p-6 text-zinc-300">
        <h2 className="text-lg font-semibold tracking-tight">
          <span className="text-cyan-500">MotaBuild Labs</span>
          <span className="text-zinc-400">: Active Experiments</span>
        </h2>
        <p className="mt-1 font-mono text-xs text-zinc-500">
          Real-Time Collaborative Markdown Space
        </p>

        <Button
          variant="default"
          className="mt-5 bg-cyan-600 text-white hover:bg-cyan-700"
          disabled={createDocumentSpace.isPending}
          onClick={() => createDocumentSpace.mutate({})}
        >
          {createDocumentSpace.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Plus />
          )}
          Create Collaborative Markdown Space
        </Button>
      </section>
    </div>
  )
}
