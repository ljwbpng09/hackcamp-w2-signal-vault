import Link from 'next/link'
import {
  Activity,
  BrainCircuit,
  ExternalLink,
  ChevronRight,
  LinkIcon,
  Bell,
} from 'lucide-react'

/**
 * Landing page — static Server Component, no fetch.
 * Goal: judge understands the project in 10 seconds.
 */

const GITHUB_URL = 'https://github.com/ljwbpng09/hackcamp-w2-signal-vault'

// ── How it works steps ────────────────────────────────────────────────────────

const STEPS = [
  {
    icon: Activity,
    title: 'Monitor',
    desc: 'Worker polls Polymarket CLOB every 60 s and tracks real-time probability shifts for World Cup markets.',
  },
  {
    icon: BrainCircuit,
    title: 'Decide',
    desc: 'LLM analyses the price history, makes a directional prediction (UP / DOWN), and rates urgency.',
  },
  {
    icon: LinkIcon,
    title: 'Anchor',
    desc: 'Prediction is written on-chain via SignalVault.sol before the outcome is known, then auto-settled 10 min later.',
  },
]

// ── Tech badges ───────────────────────────────────────────────────────────────

const BADGES = [
  'Polymarket CLOB',
  'MiniMax LLM',
  'Viem + Sepolia',
  'Next.js 15',
  'Telegram Bot',
  'AI × Web3',
]

// ─────────────────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-5xl mx-auto px-6 py-24 flex flex-col items-center gap-24">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="flex flex-col items-center text-center gap-8 w-full">

          {/* Logo placeholder — swap with <img src="/logo.png"> once you have one */}
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 text-white text-2xl font-extrabold shadow-lg shadow-indigo-900/50 select-none">
            SV
          </div>

          {/* Live badge */}
          <div className="inline-flex items-center gap-2 bg-indigo-950 border border-indigo-800 rounded-full px-4 py-1.5 text-xs text-indigo-300 font-medium">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            AI × Web3 Hackathon · Week 2
          </div>

          {/* Title */}
          <h1 className="text-2xl font-extrabold tracking-tight leading-tight sm:text-[clamp(2.5rem,6vw,4rem)]">
            Signal{' '}
            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              Vault
            </span>
          </h1>

          {/* One-liner */}
          <p className="text-lg text-slate-400 max-w-2xl leading-relaxed">
            The AI that puts its predictions{' '}
            <strong className="text-slate-200">on-chain before the market moves</strong> —
            a verifiable track record for AI-driven Polymarket signals.
          </p>

          {/* CTA buttons */}
          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-xl text-sm font-semibold transition-colors shadow-lg shadow-indigo-900/40"
            >
              Open Dashboard
              <ChevronRight className="w-4 h-4" />
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-sm font-semibold text-slate-300 transition-colors"
            >
              GitHub
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section className="w-full flex flex-col items-center gap-10">
          <h2 className="text-lg font-semibold text-slate-400 uppercase tracking-widest">
            How it works
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
            {STEPS.map(({ icon: Icon, title, desc }, i) => (
              <div
                key={title}
                className="relative bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col gap-4"
              >
                {/* Step number */}
                <span className="absolute top-5 right-5 text-xs text-slate-700 font-mono font-bold">
                  0{i + 1}
                </span>

                {/* Icon */}
                <div className="w-10 h-10 rounded-xl bg-indigo-950 border border-indigo-900/60 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-indigo-400" />
                </div>

                {/* Text */}
                <div>
                  <p className="text-sm font-semibold text-slate-100 mb-1">{title}</p>
                  <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Connector arrows between steps (desktop only) */}
          <p className="text-xs text-slate-700 hidden md:block">
            poll → detect → predict on-chain → settle → Telegram
          </p>
        </section>

        {/* ── Differentiator callout ────────────────────────────────────────── */}
        <section className="w-full bg-indigo-950/40 border border-indigo-900/50 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-10 h-10 shrink-0 rounded-xl bg-indigo-900/60 flex items-center justify-center">
            <Bell className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-indigo-300 mb-1">Why this is different</p>
            <p className="text-sm text-slate-400 leading-relaxed">
              Most AI alert tools only log after the fact.{' '}
              <strong className="text-slate-200">Signal Vault commits the prediction on-chain first</strong>,
              then auto-settles it 10 minutes later — creating a tamper-proof AI accuracy score
              anyone can audit on Etherscan without trusting us.
            </p>
          </div>
        </section>

        {/* ── Tech badges ───────────────────────────────────────────────────── */}
        <section className="flex flex-col items-center gap-4 w-full">
          <p className="text-xs text-slate-600 uppercase tracking-widest">Built with</p>
          <div className="flex flex-wrap justify-center gap-2">
            {BADGES.map((b) => (
              <span
                key={b}
                className="px-3 py-1 rounded-full border border-slate-800 bg-slate-900 text-xs text-slate-400"
              >
                {b}
              </span>
            ))}
          </div>
        </section>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <footer className="text-xs text-slate-700 text-center">
          Signal Vault · AI × Web3 Hackathon 2026
        </footer>

      </div>
    </main>
  )
}
