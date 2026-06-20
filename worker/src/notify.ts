/**
 * Telegram push notifications.
 *
 * sendTGAlert() is the named export used by alert.ts.
 * notify()     is the legacy export kept for backward compatibility.
 *
 * D4: replace the placeholder body with actual Telegram Bot API calls.
 * Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.
 */

// TODO (D4): Implement Telegram push.
//
// import axios from 'axios'
// import { withRetry } from './retry.js'
//
// async function doSend(text: string): Promise<void> {
//   const token = process.env.TELEGRAM_BOT_TOKEN
//   const chatId = process.env.TELEGRAM_CHAT_ID
//   if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set')
//   await axios.post(
//     `https://api.telegram.org/bot${token}/sendMessage`,
//     { chat_id: chatId, text, parse_mode: 'Markdown' },
//     { timeout: 8_000 },
//   )
// }
//
// async function sendWithRetry(text: string): Promise<void> {
//   await withRetry(() => doSend(text), {
//     label: '[notify]',
//     attempts: 2,
//     baseDelayMs: 1_000,
//     jitterMs: 300,
//   })
// }

const URGENCY_PREFIX: Record<string, string> = {
  high: '🚨 [HIGH]',
  medium: '⚠️  [MEDIUM]',
  low: 'ℹ️  [LOW]',
}

/**
 * Send an alert notification via Telegram.
 * @param message  Formatted message string (Markdown safe)
 * @param urgency  'low' | 'medium' | 'high' — affects console prefix until D4
 */
export async function sendTGAlert(message: string, urgency = 'medium'): Promise<void> {
  // TODO (D4): replace console.log with sendWithRetry(message)
  const prefix = URGENCY_PREFIX[urgency] ?? '📣'
  console.log(`[notify] ${prefix} TG alert (placeholder):`)
  console.log(message)
}

/**
 * Legacy export — kept for any caller that still uses notify() directly.
 */
export async function notify(message: string): Promise<void> {
  await sendTGAlert(message)
}
