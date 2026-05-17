/**
 * @pyn/core — shared business logic для desktop (Electron) и mobile (RN).
 *
 *   • api       — ApiClient + transport + errors
 *   • auth      — Role + Permission matrix + Session
 *   • endpoints — типизированные обёртки над action'ами сервера
 *   • crypto    — X25519 + AES-GCM (stage 2)
 *   • types     — domain types (NewsItem, Poll, ChatPartner, ...)
 *
 * UI код импортирует:
 *   import { ApiClient, login, can, type Role } from '@pyn/core';
 */
export * from './api';
export * from './auth';
export * from './endpoints';
export * from './crypto';
export * from './types';
export * from './store';
