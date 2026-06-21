import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Signal Vault',
  description: 'AI-powered Polymarket signal monitor with on-chain alert logging',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark bg-gray-950">
      <body className="antialiased">{children}</body>
    </html>
  )
}
