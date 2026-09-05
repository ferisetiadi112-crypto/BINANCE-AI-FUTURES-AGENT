/**
 * Internal test export for chat-agent.ts.
 *
 * The production module only exposes the boss-guarded server function; this
 * thin re-export lifts the pure provider-chain walker for unit tests without
 * changing the production surface.
 */

export { runChatProviders as runChatProvidersForTest } from "./chat-agent-providers";
