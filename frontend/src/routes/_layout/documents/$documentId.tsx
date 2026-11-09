import { createFileRoute } from "@tanstack/react-router"

import RealTimeEditor from "@/components/Document/RealTimeEditor"

export const Route = createFileRoute("/_layout/documents/$documentId")({
  component: DocumentWorkspace,
  head: () => ({
    meta: [
      {
        title: "Document - MotaBuild Labs",
      },
    ],
  }),
})

function DocumentWorkspace() {
  const { documentId } = Route.useParams()

  return (
    <div>
      <div className="mb-4">
        <h1 className="truncate text-2xl">Document Workspace</h1>
        <p className="font-mono text-xs text-muted-foreground">
          Room :: {documentId}
        </p>
      </div>
      <RealTimeEditor documentId={documentId} />
    </div>
  )
}
