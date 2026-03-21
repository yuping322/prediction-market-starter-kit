import Link from "next/link"
import { Separator } from "@/components/ui/separator"
import { ThemeToggle } from "@/components/theme-toggle"
import { SearchCommand } from "@/components/search-command"
import { AuthButton } from "@/components/auth-button"
import { Button } from "@/components/ui/button"

export function Navbar() {
  return (
    <header className="border-b">
      <nav className="flex h-16 items-center gap-4 px-6 max-w-[90rem] mx-auto">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <svg width="40" height="40" viewBox="0 0 73 49" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M46.8676 24C46.8676 36.4264 36.794 46.5 24.3676 46.5C11.9413 46.5 1.86765 36.4264 1.86765 24C1.86765 11.5736 11.9413 1.5 24.3676 1.5C36.794 1.5 46.8676 11.5736 46.8676 24Z" className="fill-teal-400 dark:fill-teal-500" />
            <path d="M71.1324 24C71.1324 36.4264 61.1574 46.5 48.8529 46.5C36.5484 46.5 26.5735 36.4264 26.5735 24C26.5735 11.5736 36.5484 1.5 48.8529 1.5C61.1574 1.5 71.1324 11.5736 71.1324 24Z" className="fill-red-300 dark:fill-red-400/60" />
            <path d="M36.6705 42.8416C42.8109 38.8239 46.8676 31.8858 46.8676 24C46.8676 16.1144 42.8109 9.17614 36.6705 5.15854C30.5904 9.17614 26.5735 16.1144 26.5735 24C26.5735 31.8858 30.5904 38.8239 36.6705 42.8416Z" className="fill-teal-700 dark:fill-teal-400" />
          </svg>
          <span className="font-semibold tracking-tight">Predict</span>
        </Link>

        <div className="flex-1 flex justify-center">
          <SearchCommand />
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Button variant="ghost" size="icon-sm"  asChild>
            <a href="https://github.com/suhailkakar/prediction-market-starter-kit" target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 16 16" fill="currentColor" className="size-4"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
            </a>
          </Button>

          <Separator orientation="vertical" className="!h-5" />

          <ThemeToggle />

          <Separator orientation="vertical" className="!h-5" />

          <AuthButton />
        </div>
      </nav>
    </header>
  )
}
