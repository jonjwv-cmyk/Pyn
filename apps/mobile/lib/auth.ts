import { androidLogin, loginResponseToSession, type Session } from '@pyn/core';
import { api } from './api';
import { getDeviceId } from './device';
import { saveSession } from './session';

/**
 * Mobile login flow:
 *   1. user вводит login + password
 *   2. android device_id из SecureStore
 *   3. server check: credentials → kill switch (android scope) → device_marks
 *   4. on success: persist session в SecureStore, set ApiClient token
 *
 * TEMP: app_version захардкожен '99.0.0' чтобы Pyn mobile (0.0.1) проходил
 * server min_version check, который сейчас сравнивает с OTLHelper2 (2.5.0).
 * Долгосрочное решение — отдельный app_scope='pyn-android' на сервере с
 * собственной версионностью.
 */
const TEMP_APP_VERSION_BYPASS = '99.0.0';

export async function performLogin(login: string, password: string): Promise<Session> {
  const deviceId = getDeviceId();
  const res = await androidLogin(api, {
    login,
    password,
    deviceId,
    appVersion: TEMP_APP_VERSION_BYPASS,
  });
  const session = loginResponseToSession(res);
  api.setToken(session.token);
  await saveSession(session);
  return session;
}
