/**
 * Telegram push notifications — full implementation.
 *
 * Env keys (in worker/.env):
 *   TELEGRAM_BOT_TOKEN   Bot token from @BotFather
 *   TELEGRAM_CHAT_ID     Your personal chat ID or group ID
 *   HTTPS_PROXY          Optional — proxy for restricted networks
 *
 * Two modes:
 *   pushBot        polling:false — safe to import in multiple files, used for alerts
 *   setupCommands  starts a polling:true bot for /status, /snapshot, /mute commands
 *                  — call exactly once from main()
 */
import TelegramBot from 'node-telegram-bot-api'
import { readFileSync } from 'node:fs'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID   ?? ''
const PROXY     = process.env.HTTPS_PROXY

if (!BOT_TOKEN || !CHAT_ID) {
  console.warn('[notify] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — alerts will console.log only')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const botOpts: any = { polling: false }
if (PROXY) botOpts.request = { proxy: PROXY }

/** Push-only bot: safe to use across the whole codebase. */
export const pushBot = BOT_TOKEN ? new TelegramBot(BOT_TOKEN, botOpts) : null

// ─── Shared runtime state (read by /status command) ───────────────────────────

export const botState = {
  totalDecisions:  0,
  alertsTriggered: 0,
  /** Etherscan link of the most recent on-chain TX. */
  lastTxUrl: '',
}

// ─── Deduplication ────────────────────────────────────────────────────────────

const recentAlerts = new Map<string, number>()

// ─── Mute ────────────────────────────────────────────────────────────────────

let muteUntil = 0

export function isMuted(): boolean {
  return Date.now() < muteUntil
}

export function muteAlertsFor(ms: number): void {
  muteUntil = Date.now() + ms
}

// ─── sendTGAlert ─────────────────────────────────────────────────────────────

export interface SendTGAlertOpts {
  dedupeKey?:      string
  dedupeWindowMs?: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extra?:          Record<string, any>
}

/**
 * Send a Telegram message via the push bot.
 * Falls back to console.log when bot is not configured.
 */
export async function sendTGAlert(text: string, opts: SendTGAlertOpts = {}): Promise<void> {
  if (!pushBot) {
    console.log('[notify-noop]', text)
    return
  }

  if (isMuted()) {
    console.log('[notify-muted]', text)
    return
  }

  if (opts.dedupeKey) {
    const last = recentAlerts.get(opts.dedupeKey)
    const win  = opts.dedupeWindowMs ?? 30 * 60_000
    if (last && Date.now() - last < win) {
      console.log(`[notify-dedupe] ${opts.dedupeKey}`)
      return
    }
    recentAlerts.set(opts.dedupeKey, Date.now())
  }

  try {
    await pushBot.sendMessage(CHAT_ID, text, {
      parse_mode: 'Markdown',
      ...opts.extra,
    })
  } catch (err) {
    console.error('[notify] sendMessage failed:', (err as Error).message)
  }
}

// ─── /add command — market queue ─────────────────────────────────────────────

/**
 * Markets queued via the /add Telegram command.
 * index.ts drains this queue in syncMatchDayMarkets() each cycle.
 */
export const pendingMarketQueue: Array<{ tokenId: string; question: string }> = []

// ─── /markets command — live market list callback ─────────────────────────────

type GetMarketsCallback = () => Array<{ tokenId: string; question: string }>
let _getMarkets: GetMarketsCallback = () => []

/**
 * Register a callback so the /markets command can list currently monitored markets.
 * Call from main() after markets are loaded:
 *   setGetMarketsCallback(() => markets)
 */
export function setGetMarketsCallback(fn: GetMarketsCallback): void {
  _getMarkets = fn
}

// ─── setupCommands — call once from main() ────────────────────────────────────

/**
 * Start the interactive (polling) bot.
 * Commands: /start /help /status /snapshot /markets /add /mute
 * Must be called exactly once. Safe no-op if BOT_TOKEN is missing.
 */
export async function setupCommands(): Promise<void> {
  if (!BOT_TOKEN) {
    console.warn('[notify] setupCommands: BOT_TOKEN missing, skipping interactive bot')
    return
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iOpts: any = { polling: true }
  if (PROXY) iOpts.request = { proxy: PROXY }
  const bot = new TelegramBot(BOT_TOKEN, iOpts)

  await bot.setMyCommands([
    { command: 'start',    description: 'Start the bot' },
    { command: 'status',   description: 'Show monitoring stats' },
    { command: 'snapshot', description: 'Latest market snapshot (all markets)' },
    { command: 'markets',  description: 'List monitored markets' },
    { command: 'add',      description: 'Add a market: /add <tokenId> <question>' },
    { command: 'mute',     description: 'Mute alerts for 1 hour' },
    { command: 'help',     description: 'Show all commands' },
  ])

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Signal Vault Bot started ✅\nSend /help to see commands.')
  })

  bot.onText(/\/help/, (msg) => {
    const text = [
      '*Signal Vault — Commands*',
      '/status        — worker stats since startup',
      '/snapshot      — latest price for all markets',
      '/markets       — list monitored markets',
      '/add <id> <q>  — add a market by tokenId + question',
      '/mute          — mute alerts for 1 hour',
    ].join('\n')
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' })
  })

  bot.onText(/\/status/, (msg) => {
    const current = _getMarkets()
    const text = [
      '*Signal Vault Status*',
      `Markets monitored:  ${current.length}`,
      `Decisions:          ${botState.totalDecisions}`,
      `Alerts triggered:   ${botState.alertsTriggered}`,
      `Last on-chain TX:   ${botState.lastTxUrl || '—'}`,
      `Muted:              ${isMuted() ? '🔇 yes' : '🔔 no'}`,
    ].join('\n')
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' })
  })

  // /snapshot — shows latest price + Track Record for every monitored market
  bot.onText(/\/snapshot/, (msg) => {
    let text = 'No snapshot data yet — is the worker running?'
    try {
      const snapshotPath = process.env.SNAPSHOT_OUTPUT_PATH ?? '../web/public/snapshot.json'
      const raw  = readFileSync(snapshotPath, 'utf-8')
      const data = JSON.parse(raw) as {
        markets?: Array<{
          question: string
          snapshots: { probability: number }[]
          alerts: { settled: boolean; correct?: boolean }[]
        }>
        // legacy single-market format
        market?: { question: string }
        snapshots?: { probability: number }[]
        alerts?: { settled: boolean; correct?: boolean }[]
      }

      // Normalise to multi-market format
      const marketList = data.markets ?? (
        data.market
          ? [{ question: data.market.question, snapshots: data.snapshots ?? [], alerts: data.alerts ?? [] }]
          : []
      )

      const lines = marketList.map((m) => {
        const latest = m.snapshots.at(-1)
        const settled = m.alerts.filter((a) => a.settled)
        const correct = settled.filter((a) => a.correct).length
        const acc = settled.length
          ? `${correct}/${settled.length} = ${((correct / settled.length) * 100).toFixed(0)}%`
          : 'no settled predictions'
        return (
          `*${m.question.slice(0, 50)}*\n` +
          `Prob: ${latest ? (latest.probability * 100).toFixed(3) + '%' : '—'}  ·  Track Record: ${acc}`
        )
      })

      text = lines.length > 0 ? lines.join('\n\n') : 'No markets in snapshot.'
    } catch { /* snapshot not yet written */ }
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' })
  })

  // /markets — list what is currently being monitored
  bot.onText(/\/markets/, (msg) => {
    const current = _getMarkets()
    if (current.length === 0) {
      bot.sendMessage(msg.chat.id, 'No markets monitored yet.')
      return
    }
    const lines = current.map((m, i) => `${i + 1}. ${m.question.slice(0, 55)}`)
    bot.sendMessage(
      msg.chat.id,
      `*Monitored Markets (${current.length})*\n${lines.join('\n')}`,
      { parse_mode: 'Markdown' },
    )
  })

  // /add <tokenId> <question text>
  // Example: /add 108233... Will France win the 2026 FIFA World Cup?
  bot.onText(/\/add (.+)/, (msg, match) => {
    const parts = (match?.[1] ?? '').trim().split(/\s+/)
    const tokenId = parts[0] ?? ''
    const question = parts.slice(1).join(' ')

    if (!tokenId || tokenId.length < 10 || !question) {
      bot.sendMessage(
        msg.chat.id,
        '❌ Usage: `/add <tokenId> <question>`\nExample:\n`/add 10823... Will France win the 2026 FIFA World Cup?`',
        { parse_mode: 'Markdown' },
      )
      return
    }

    // Check for duplicates
    const existing = _getMarkets()
    if (existing.some((m) => m.tokenId === tokenId)) {
      bot.sendMessage(msg.chat.id, `⚠️ Already monitoring: ${question.slice(0, 50)}`)
      return
    }

    pendingMarketQueue.push({ tokenId, question })
    bot.sendMessage(
      msg.chat.id,
      `✅ *Market queued*\n${question.slice(0, 60)}\n\nWill appear in the next poll cycle (~60s).`,
      { parse_mode: 'Markdown' },
    )
    console.log(`[notify] /add queued: ${question.slice(0, 60)} (${tokenId.slice(0, 12)}…)`)
  })

  bot.onText(/\/mute/, (msg) => {
    muteAlertsFor(60 * 60_000)
    bot.sendMessage(msg.chat.id, '🔇 Alerts muted for 1 hour.')
  })

  bot.on('callback_query', async (query) => {
    if (query.data === 'mute_60') {
      muteAlertsFor(60 * 60_000)
      await bot.answerCallbackQuery(query.id, { text: 'Muted for 1 hour ✅' })
    }
  })

  console.log('[notify] Telegram interactive bot started (polling) — /add /markets enabled')
}
