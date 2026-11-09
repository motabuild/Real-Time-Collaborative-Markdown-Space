import { Link } from "@tanstack/react-router"

import { cn } from "@/lib/utils"

interface LogoProps {
  variant?: "full" | "icon" | "responsive"
  className?: string
  asLink?: boolean
}

function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-lg font-semibold tracking-tight whitespace-nowrap",
        className,
      )}
    >
      <span className="text-cyan-500 font-bold">MotaBuild</span> Labs
    </span>
  )
}

function Monogram({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("text-cyan-500 text-lg font-bold", className)}
    >
      MB
    </span>
  )
}

export function Logo({
  variant = "full",
  className,
  asLink = true,
}: LogoProps) {
  const content =
    variant === "responsive" ? (
      <>
        <Wordmark
          className={cn("group-data-[collapsible=icon]:hidden", className)}
        />
        <Monogram
          className={cn(
            "hidden group-data-[collapsible=icon]:block",
            className,
          )}
        />
      </>
    ) : variant === "full" ? (
      <Wordmark className={className} />
    ) : (
      <Monogram className={className} />
    )

  if (!asLink) {
    return content
  }

  return (
    <Link aria-label="MotaBuild Labs" to="/">
      {content}
    </Link>
  )
}
