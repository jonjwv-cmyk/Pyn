/**
 * @pyn/core — shared business logic для desktop (Electron) и mobile (RN).
 *
 *   • api       — ApiClient + transport + errors + ws-events
 *   • auth      — Role + Permission matrix + Session
 *   • endpoints — типизированные обёртки над action'ами сервера
 *   • crypto    — X25519 + AES-GCM + HKDF + envelope (REST + WS) + blob
 *   • store     — Zustand stores (news, chats, mol, users, ui-state, etc)
 *   • i18n      — initI18n + locales (ru/en/es/uk/de)
 *   • types     — domain types (NewsItem, Poll, ChatPartner, ...)
 *
 * UI код импортирует:
 *   import { ApiClient, login, can, type Role } from '@pyn/core';
 */
export * from './api';
export * from './auth';
export * from './avatar-colors';
export * from './default-avatars';
export * from './endpoints';
export * from './crypto';
export * from './mol-query';
export * from './mols-html';
export * from './person-fio';
export * from './person-normalize';
export * from './reactions';
export * from './types';
export * from './store';
export * from './i18n';
