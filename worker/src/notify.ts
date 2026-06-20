/**
 * Telegram push notifications (D4 TODO).
 *
 * Sends alert messages to a configured Telegram chat via the Bot API.
 * Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.
 */

// TODO (D4): Implement Telegram push.
//
// import axios from 'axios'
// import { withRetry } from './retry.js'
//
// async function doSend(message: string): Promise<void> {
//   const token = process.env.TELEGRAM_BOT_TOKEN
//   const chatId = process.env.TELEGRAM_CHAT_ID
//   if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set')
//   await axios.post(
//     `https://api.telegram.org/bot${token}/sendMessage`,
//     { chat_id: chatId, text: message, parse_mode: 'Markdown' },
//     { timeout: 8_000 },
//   )
// }

/**
 * Send a notification message. Falls back to console.log until D4.
 */
export async function notify(message: string): Promise<void> {
  // TODO (D4): Replace placeholder with withRetry():
  // await withRetry(() => doSend(message), {
  //   label: '[notify]',
  //   attempts: 2,
  //   baseDelayMs: 1_000,
  //   jitterMs: 300,
  // })

  console.log('[notify] placeholder — implement in D4:', message)
}
