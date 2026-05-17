/**
 * @pyn/core/endpoints — типизированные обёртки над ApiClient.call() для
 * каждого серверного action. Wire-формат (snake_case) изолирован здесь —
 * внешний код работает только с camelCase TS-объектами.
 */

// Auth
export {
  login,
  me,
  appStatus,
  getPasswordCounter,
  loginResponseToSession,
  requestPcSessionQr,
  checkPcSessionStatus,
  extendSession,
  meSessionInfo,
  type LoginRequest,
  type LoginResponse,
  type MeResponse,
  type AppStatusRequest,
  type AppStatusResponse,
  type PasswordCounter,
  type RequestPcSessionQrRequest,
  type RequestPcSessionQrResponse,
  type CheckPcSessionStatusResponse,
  type PcSessionStatus,
  type MeSessionInfo,
} from './auth';

// News
export {
  getNews,
  sendNews,
  voteNewsPoll,
  pinMessage,
  unpinMessage,
  softDeleteMessage,
  undeleteMessage,
  editMessage,
  getNewsReaders,
  getPollStats,
  type GetNewsRequest,
  type NewsItemWire,
  type AttachmentWire,
  type PollWire,
  type SendNewsRequest,
  type SendNewsResponse,
  type NewsReaderWire,
  type NewsReadersResponse,
  type PollVoterWire,
  type PollStatsResponse,
} from './news';

// Reactions
export {
  addReaction,
  removeReaction,
  getReactions,
  type ReactionRequest,
  type ReactionsDetails,
  type ReactionVoter,
} from './reactions';

// Admin (users list etc)
export { getUsers, type UserSummary } from './admin';

// Chats
export {
  getAdminMessages,
  getAdminChat,
  sendMessage,
  markMessageRead,
  type GetAdminMessagesRequest,
  type GetAdminChatRequest,
  type ConversationSummaryWire,
  type ChatMessageWire,
  type SendMessageRequest,
  type SendMessageResponse,
} from './chats';
