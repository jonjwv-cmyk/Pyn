import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, Text, View } from 'react-native';

/**
 * «Управление» panel (RN, developer-only). Аналог desktop AppControlPanel.
 *
 * Источник правды — Zustand store (sync), без loading на mount, без прыжков.
 * Каждый scope (PC / Android) — отдельный toggle, мгновенный рендер из текущего
 * state, обновляется через WS push.
 */

export type AppLockState = 'normal' | 'paused' | 'wiping' | 'wiped';
export type AppLockScope = 'desktop' | 'android';

export interface AppLockScopeStatus {
  state: AppLockState;
  initiatedBy: string;
  wipeAt: string | null;
}

export interface AppControlPanelProps {
  desktop: AppLockScopeStatus;
  android: AppLockScopeStatus;
  onToggle: (scope: AppLockScope, next: boolean) => void;
  submitting?: AppLockScope | null;
}

export function AppControlPanel({
  desktop, android, onToggle, submitting,
}: AppControlPanelProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.scrollContent}>
      <View style={styles.header}>
        <Text style={styles.heading}>{t('settings_control.title')}</Text>
        <Text style={styles.sub}>{t('settings_control.subtitle')}</Text>
      </View>

      <ScopeCard
        label={t('settings_control.scope_pc')}
        sublabel={t('settings_control.scope_pc_idle')}
        status={desktop}
        submitting={submitting === 'desktop'}
        onToggle={(next) => onToggle('desktop', next)}
      />

      <ScopeCard
        label={t('settings_control.scope_android')}
        sublabel={t('settings_control.scope_android_idle')}
        status={android}
        submitting={submitting === 'android'}
        onToggle={(next) => onToggle('android', next)}
      />
    </View>
  );
}

interface ScopeCardProps {
  label: string;
  sublabel: string;
  status: AppLockScopeStatus;
  submitting: boolean;
  onToggle: (next: boolean) => void;
}

function ScopeCard({ label, sublabel, status, submitting, onToggle }: ScopeCardProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const isPaused = status.state === 'paused';
  const isWiping = status.state === 'wiping';
  const isWiped = status.state === 'wiped';
  const isActive = isPaused || isWiping || isWiped;

  const wipeAtMs = useMemo(() => {
    if (!status.wipeAt) return null;
    const ms = Date.parse(status.wipeAt.replace(' ', 'T') + 'Z');
    return Number.isFinite(ms) ? ms : null;
  }, [status.wipeAt]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isPaused) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isPaused]);

  const remainingMs = wipeAtMs !== null ? Math.max(0, wipeAtMs - now) : 0;

  return (
    <View style={[styles.card, isActive && styles.cardActive]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardLabel}>{label}</Text>
          <Text style={styles.cardSublabel}>
            {isPaused ? t('settings_control.status_active')
              : isWiping ? t('settings_control.status_wiping')
              : isWiped ? t('settings_control.status_wiped')
              : sublabel}
          </Text>
        </View>
        <Switch
          value={isActive}
          disabled={submitting || isWiped}
          onValueChange={onToggle}
          trackColor={{ false: 'rgba(255,255,255,0.08)', true: '#D97757' }}
          thumbColor="#FFFFFF"
          ios_backgroundColor="rgba(255,255,255,0.08)"
        />
      </View>

      {isPaused && wipeAtMs !== null && (
        <View style={styles.countdownBox}>
          <Text style={styles.countdownLabel}>{t('settings_control.countdown_label')}</Text>
          <Text style={styles.countdownValue}>{formatRemaining(remainingMs)}</Text>
          <Text style={styles.countdownDate}>{formatYekWipeAt(wipeAtMs, i18n.resolvedLanguage || 'ru')}</Text>
          <Text style={styles.countdownInfo}>
            {t('settings_control.warning_reinstall')}
          </Text>
        </View>
      )}
    </View>
  );
}

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/** Yek TZ, формат с локалью текущего i18n языка. */
function formatYekWipeAt(ms: number, locale: string): string {
  const d = new Date(ms);
  // BCP-47 совместимость: 'ru' → 'ru-RU', 'uk' → 'uk-UA' и т.д. Intl сам
  // подтянет регион по умолчанию если передать только базовый код.
  const dateStr = new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Yekaterinburg',
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(d).replace(/\s*г\.?\s*$/, '');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yekaterinburg',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const h24 = parseInt(m.hour ?? '0', 10) || 0;
  const period = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${dateStr}, ${h12}:${m.minute}:${m.second} ${period}`;
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#1F1E1B',
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  header: {
    gap: 4,
  },
  heading: {
    color: '#F5F4EF',
    fontSize: 17,
    fontWeight: '500',
  },
  sub: {
    color: '#A6A39B',
    fontSize: 12,
  },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(108,106,96,0.25)',
    backgroundColor: 'rgba(48,47,45,0.3)',
    padding: 16,
    gap: 16,
  },
  cardActive: {
    borderColor: 'rgba(217, 119, 87, 0.3)',
    backgroundColor: 'rgba(217, 119, 87, 0.08)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
  },
  cardHeaderText: {
    flex: 1,
    gap: 2,
  },
  cardLabel: {
    color: '#F5F4EF',
    fontSize: 14,
    fontWeight: '500',
  },
  cardSublabel: {
    color: '#A6A39B',
    fontSize: 11,
  },
  countdownBox: {
    borderRadius: 6,
    backgroundColor: 'rgba(22, 22, 17, 0.4)',
    padding: 12,
    gap: 4,
  },
  countdownLabel: {
    color: '#A6A39B',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  countdownValue: {
    color: '#D97757',
    fontSize: 24,
    fontFamily: 'Menlo',
    fontVariant: ['tabular-nums'],
  },
  countdownDate: {
    color: '#A6A39B',
    fontSize: 11,
  },
  countdownInfo: {
    color: '#A6A39B',
    fontSize: 11,
    marginTop: 4,
  },
});
