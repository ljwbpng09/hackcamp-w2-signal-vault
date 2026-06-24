import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI Blackbox',
  description: 'Commit first. Score later. AI Blackbox seals every prediction on-chain before results, then auto-grades it.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark bg-gray-950">
      <body className="antialiased">{children}</body>
    </html>
  )
}
