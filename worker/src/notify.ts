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

// ─── setupCommands — call once from main() ────────────────────────────────────

/**
 * Start the interactive (polling) bot and register /status /snapshot /mute /help.
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
    { command: 'snapshot', description: 'Latest market snapshot' },
    { command: 'mute',     description: 'Mute alerts for 1 hour' },
    { command: 'help',     description: 'Show all commands' },
  ])

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Signal Vault Bot started ✅\nSend /help to see commands.')
  })

  bot.onText(/\/help/, (msg) => {
    const text = [
      '*Signal Vault — Commands*',
      '/status   — stats since worker start',
      '/snapshot — latest price + recent alerts',
      '/mute     — mute alerts for 1 hour',
    ].join('\n')
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' })
  })

  bot.onText(/\/status/, (msg) => {
    const text = [
      '*📊 Signal Vault Status*',
      `Decisions this session: ${botState.totalDecisions}`,
      `Alerts triggered:       ${botState.alertsTriggered}`,
      `Last on-chain TX:       ${botState.lastTxUrl || '—'}`,
      `Muted:                  ${isMuted() ? '🔇 yes' : '🔔 no'}`,
    ].join('\n')
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' })
  })

  bot.onText(/\/snapshot/, (msg) => {
    let text = 'No snapshot yet.'
    try {
      const snapshotPath = process.env.SNAPSHOT_OUTPUT_PATH ?? '../web/public/snapshot.json'
      const raw  = readFileSync(snapshotPath, 'utf-8')
      const data = JSON.parse(raw) as {
        market: { question: string }
        snapshots: { timestamp: string; probability: number }[]
        alerts: { reason: string; direction: string; settled: boolean; correct?: boolean }[]
      }
      const latest = data.snapshots.at(-1)
      const settled = data.alerts.filter((a) => a.settled)
      const correctCount = settled.filter((a) => a.correct).length
      const accuracy = settled.length ? `${correctCount}/${settled.length} = ${((correctCount / settled.length) * 100).toFixed(1)}%` : 'n/a'
      text = [
        `*${data.market.question}*`,
        `Latest prob: ${latest ? (latest.probability * 100).toFixed(2) + '%' : '—'}`,
        `Snapshots:   ${data.snapshots.length}`,
        `AI Track Record: ${accuracy}`,
      ].join('\n')
    } catch { /* snapshot not yet written */ }
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' })
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

  console.log('[notify] Telegram interactive bot started (polling)')
}
