import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import Image from "next/image";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "The Giveaways Club Analytics",
  description: "TGC dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <header className="sticky top-0 z-50 w-full border-b border-card-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container px-4 flex h-14 max-w-screen-2xl items-center justify-between">
            <div className="text-sm flex items-center space-x-2">
              <a href="https://www.steamgifts.com/group/WlYTQ/thegiveawaysclub" target="_blank" rel="noopener noreferrer">
                <Image
                  width={32}
                  height={32}
                  src="https://avatars.fastly.steamstatic.com/13cc7998f870155897fd892086cfcee14670c978_full.jpg"
                  alt="SteamGifts Analytics Logo"
                  className="h-8 w-8 rounded-full object-cover"
                />
              </a>
              <Link href="/" >
                <span className="font-bold hidden md:block">The Giveaways Club</span>
                <span className="font-bold md:hidden">TGC</span>
              </Link>
            </div>
            <nav className="flex items-center gap-4 text-sm font-medium text-muted-foreground">
              <Link
                href="/games"
                className="transition-colors hover:text-foreground"
              >
                Games
              </Link>
              <Link
                href="/giveaways"
                className="transition-colors hover:text-foreground"
              >
                Giveaways
              </Link>
              <Link
                href="/users"
                className="transition-colors hover:text-foreground"
              >
                Users
              </Link>
              <Link
                href="/stats"
                className="transition-colors hover:text-foreground"
              >
                Leavers
              </Link>
            </nav>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </body>
    </html>
  );
}
