/**
 * @pyn/core/endpoints — типизированные обёртки над ApiClient.call() для
 * каждого серверного action. Wire-формат (snake_case) изолирован здесь —
 * внешний код работает только с camelCase TS-объектами.
 */

// Auth
export {
  login,
  androidLogin,
  me,
  appStatus,
  heartbeat,
  getPasswordCounter,
  loginResponseToSession,
  requestPcSessionQr,
  checkPcSessionStatus,
  extendSession,
  meSessionInfo,
  changePassword,
  type LoginRequest,
  type AndroidLoginRequest,
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
  type SessionKind,
} from './auth';

// News
export {
  getNews,
  sendNews,
  createNewsPoll,
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
  type CreateNewsPollRequest,
  type CreateNewsPollResponse,
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

// Admin (users management)
export {
  getUsers,
  createUser,
  resetPassword,
  toggleUser,
  renameUser,
  changeLogin,
  changeRole,
  deleteUser,
  resetPasswordLoginCounter,
  type UserSummary,
  type CreateUserRequest,
  type CreateUserResponse,
} from './admin';

// Base — справочник МОЛ (загрузка, парсинг, server-side search)
export {
  baseVersion,
  baseDownloadUrl,
  baseFind,
  rebroadcastBase,
  parseSnapshotJson,
  hasRealWarehouse,
  type BaseMeta,
  type BaseDownloadInfo,
  type MolRecord,
} from './base';

// Warehouses — справочник складов («Цеха»-база), server-sync как у МОЛ
export {
  warehousesVersion,
  warehousesDownload,
  warehousesDownloadUrl,
  warehouseUpdate,
  parseWarehousesSnapshotJson,
  type WarehousesMeta,
  type WarehousesDownloadInfo,
  type WarehousePatch,
} from './warehouses';

// Persons — единая база ПЕРСОН (ФИО + МОЛ), вкладка «Контакты». МОЛ — производное.
export {
  personsImportMols,
  personsVersion,
  personsDownload,
  personsDownloadUrl,
  personUpdate,
  personCreate,
  parsePersonsSnapshotJson,
  BROADCAST_GROUPS,
  BROADCAST_PURPOSE_OPTIONAL_GROUPS,
  parseBroadcastApprovalWarehouses,
  serializeBroadcastApprovalWarehouses,
  type BroadcastGroup,
  type Person,
  type PersonWarehouse,
  type PersonsMeta,
  type PersonsDownloadInfo,
  type PersonPatch,
  type PersonCreateInput,
  type PersonsMolsImportEntry,
  type PersonsMolsImportResult,
} from './persons';

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

// Drafts
export {
  saveDraft,
  loadDraft,
  listDrafts,
  type DraftSnapshot,
  type DraftListItem,
} from './drafts';

// Scheduled messages
export {
  scheduleMessage,
  listScheduled,
  cancelScheduled,
  type ScheduledKind,
  type ScheduleNewsPayload,
  type ScheduleMessageRequest,
  type ScheduleMessageResponse,
  type ScheduledStatus,
  type ScheduledMessage,
  type ScheduledMessageWire,
} from './scheduled';

// Sheets bridge (Google Sheets API + macros)
export {
  listSheets,
  getSheet,
  updateCell,
  runScript,
  checkSheetActionStatus,
  releaseSheetLock,
  getMacroBundle,
  submitMacroData,
  searchSapDoc,
  getSheetsClientConfig,
  getSheetStats,
  type SheetSummary,
  type SheetTab,
  type SheetSnapshot,
  type UpdateCellResult,
  type MacroBundle,
  type SapDocHit,
  type SheetsClientConfig,
  type SheetStatsResult,
} from './sheets';

// Storage activity (§pyn-1.2.53) — кто последний открывал файл/папку
export {
  logStorageOpen,
  getStorageOpeners,
  type StorageOpenerInfo,
} from './storage-activity';

// Kill switch / app lock (2026-05-20)
export {
  activateAppLock,
  deactivateAppLock,
  getAppLockStatus,
  confirmWipe,
  type AppLockState as AppLockServerState,
  type AppLockScope,
  type AppLockStatus,
  type AppLockScopeStatus,
} from './app-lock';

// Schedule (§TZ-SERVER-SYNC-COLLAB этап A — server-sync графика, 2026-05-27)
export {
  scheduleGet,
  schedulePut,
  scheduleMonthsList,
  prodCalendarGet,
  readConflictSnapshot,
  scheduleLockAcquire,
  scheduleLockHeartbeat,
  scheduleLockRelease,
  readLockOwner,
  type ScheduleStatePayload,
  type ScheduleSnapshot,
  type ScheduleMonthSummary,
  type SchedulePutResult,
  type ScheduleLockOwner,
  type ProdCalendarYearWire,
} from './schedule';

export {
  flowWorkflowGet,
  flowWorkflowEdit,
  flowWorkflowDelete,
  flowPlanMonthGet,
  flowPlanMonthSet,
  flowViewGet,
  flowViewSet,
  flowColLayoutGet,
  flowColLayoutSet,
  flowTransportViewGet,
  flowTransportViewSet,
  type FlowColLayoutGrid,
  flowImport,
  flowImportRunsGet,
  flowSapRunsGet,
  flowMolsRunsGet,
  flowZmvlReconcile,
  flowScriptPress,
  flowScriptPressesGet,
  flowScriptRunsGet,
  flowStockImport,
  flowStockGet,
  flowStockStatus,
  parseOrdersTsv,
  parseZmvlTsv,
  parseSedTsv,
  type FlowRow,
  type FlowEdit,
  type FlowPlanMonth,
  type FlowView,
  type FlowImportRow,
  type FlowImportResult,
  type FlowImportRun,
  type FlowSapRun,
  type FlowMolsRun,
  type FlowZmvlRow,
  type FlowZmvlReconcileResult,
  type FlowSedRow,
  type FlowScriptId,
  type FlowScriptPress,
  type FlowScriptRun,
  type FlowStockImportResult,
  type FlowStockRow,
  type FlowStockStatus,
} from './flow';

export {
  mapGet,
  mapSet,
  mapRoadSuggestionsGet,
  mapRailwaysGet,
  mapBuildingsGet,
  mapFootwaysGet,
  mapRefGet,
  type MapBBox,
  type MapDocResult,
  type MapRoadSuggestionWire,
  type MapRailwayWire,
  type MapBuildingWire,
  type MapFootwayWire,
  type MapRefWire,
} from './map';

export {
  flowDeliveriesGet,
  flowDeliveriesEdit,
  flowDeliveriesDelete,
  flowTransfer,
  flowPlanForm,
  flowPlanFix,
  flowDeliveryEventsGet,
  flowDeliveryAdd,
  flowSedReconcile,
  parsePlanPasteTsv,
  flowPlanRowsApply,
  flowXlsxLayoutGet,
  type FlowXlsxColumn,
  type FlowXlsxLayout,
  type FlowDeliveryRow,
  type FlowDeliveryEdit,
  type FlowPlanFormResult,
  type FlowDeliveryEvent,
  type FlowDeliveryAddInput,
  type FlowPlanPasteRow,
  type FlowPlanRowsApplyResult,
} from './flow-plan';

export {
  clientErrorLog,
  clientErrorsGet,
  type ClientErrorReport,
  type ClientErrorRow,
} from './client-errors';

export {
  flowVehiclesGet,
  flowVehiclesUpsert,
  flowTransportGet,
  flowTransportPaste,
  flowTransportEdit,
  flowTransportAdd,
  flowTransportDelete,
  parseTransportPaste,
  FLOW_TRANSPORT_STATUSES,
  type FlowVehicle,
  type FlowTransportRow,
  type FlowTransportPasteRow,
  type FlowTransportPasteResult,
  type FlowTransportEdit,
} from './flow-transport';

export {
  flowVghGet,
  flowVghEdit,
  flowVghStagingGet,
  flowVghStagingEdit,
  type VghRow,
  type VghStagingRow,
  type VghEdit,
} from './flow-vgh';

export {
  optimizationStart,
  optimizationStatus,
  optimizationConfirm,
  type OptimizationPayload,
  type OptimizationPositionInput,
  type OptimizationVehicleInput,
  type OptimizationJob,
} from './optimization';
