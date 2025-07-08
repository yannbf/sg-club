import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import Image from "next/image";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SteamGifts Group Analytics",
  description: "Analytics dashboard for SteamGifts group activities",
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
            <Link href="/" className="text-sm flex items-center space-x-2">
              <Image
                width={32}
                height={32}
                src="https://avatars.fastly.steamstatic.com/13cc7998f870155897fd892086cfcee14670c978_full.jpg"
                alt="SteamGifts Analytics Logo" 
                className="h-8 w-8 rounded-full object-cover"
              />
              <span className="font-bold">The Giveaways Club</span>
            </Link>
            <nav className="flex items-center space-x-4 lg:space-x-6">
              <Link
                href="/giveaways"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Giveaways
              </Link>
              <Link
                href="/users"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Users
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
