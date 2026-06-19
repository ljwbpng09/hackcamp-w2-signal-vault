import Link from 'next/link'

const ROADMAP = [
  {
    day: 'D1 ✓',
    color: 'text-emerald-400',
    ring: 'ring-emerald-800',
    title: 'Data Pipeline',
    desc: 'Polymarket CLOB polling every 60 s, snapshot.json, dashboard line chart',
  },
  {
    day: 'D2',
    color: 'text-yellow-400',
    ring: 'ring-yellow-800',
    title: 'AI Alert Engine',
    desc: 'DeepSeek LLM detects probability shifts → SnapshotRegistry on Sepolia',
  },
  {
    day: 'D3',
    color: 'text-indigo-400',
    ring: 'ring-indigo-800',
    title: 'On-chain History',
    desc: 'Dashboard reads AlertLogged events via viem, renders alert timeline',
  },
  {
    day: 'D4',
    color: 'text-gray-500',
    ring: 'ring-gray-800',
    title: 'Notifications',
    desc: 'Telegram bot push + signal confidence scoring',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center px-6 py-20">
      <div className="max-w-3xl w-full text-center">
        <div className="inline-flex items-center gap-2 bg-indigo-950 border border-indigo-800 rounded-full px-4 py-1.5 text-indigo-300 text-sm font-medium mb-8">
          <span className="size-2 rounded-full bg-indigo-400 animate-pulse" />
          AI × Web3 Hackathon — Week 2
        </div>

        <h1 className="text-5xl font-extrabold tracking-tight mb-4">
          Signal{' '}
          <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            Vault
          </span>
        </h1>

        <p className="text-gray-400 text-lg leading-relaxed mb-10 max-w-xl mx-auto">
          Monitors Polymarket prediction markets every 60 seconds, uses an LLM to detect
          significant probability shifts, and logs immutable alerts on-chain.
        </p>

        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-7 py-3.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-xl font-semibold text-lg transition-colors shadow-lg shadow-indigo-900/40"
        >
          Open Dashboard →
        </Link>

        <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 text-left text-sm">
          {ROADMAP.map(({ day, color, ring, title, desc }) => (
            <div key={day} className={`bg-gray-900 rounded-xl p-4 ring-1 ${ring}`}>
              <div className={`font-bold mb-1 ${color}`}>{day}</div>
              <div className="font-semibold text-gray-200 mb-1">{title}</div>
              <div className="text-gray-500 text-xs leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
