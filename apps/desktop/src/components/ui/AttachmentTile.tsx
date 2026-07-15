import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileType,
  FileVideo,
  Image as ImageIcon,
  Maximize,
  Pause,
  Play,
  Sheet,
  Volume2,
  VolumeX,
  type LucideIcon,
} from 'lucide-react';
import { getDimsSync, setDimsSync, useDecryptedBlob } from '@/lib/avatar';
import { cn } from '@/lib/cn';
import type { Attachment } from '@pyn/core';

/**
 * Контекст рендера тайла. В чате юзеру можно сохранять/делиться media; в
 * ленте новостей — нет (новости — broadcast-контент, сохранение запрещено,
 * чтобы лишний раз не растекалось вне Pyn'a).
 */
export type AttachmentContext = 'chat' | 'news';

interface AttachmentTileProps {
  attachment: Attachment;
  /**
   * `chat` — стандартное поведение: image кликом открывается в новой вкладке,
   * video имеет полный набор controls (download/PiP/speed разрешены).
   * `news` — защитный режим: download/PiP/playback-speed заблокированы у
   * video, у image отключено right-click → «Сохранить как…». MAX-width
   * больше (480) — карточка новостей шире bubble чата.
   */
  context?: AttachmentContext;
}

/**
 * Универсальный тайл прикрепления — image preview, video player, file chip.
 *
 *   • `image/*` → `<img>` с blob URL (тап → открыть в новой вкладке).
 *   • `video/*` → видеоплеер Telegram-style (см. `VideoTile`).
 *   • остальное → file chip с цветной иконкой по типу + `<a download>`.
 *
 * Размер тайла зависит от `context`:
 *   • chat → max-w 320px, max-h 380px (компактнее, помещается в bubble).
 *   • news → max-w 480px, max-h 460px (карточка новостей шире).
 */
const CHAT_MEDIA_MIN = 'min-h-[140px] min-w-[200px]';

export function AttachmentTile({ attachment, context = 'chat' }: AttachmentTileProps) {
  const isImage = attachment.mimeType.startsWith('image/');
  const isVideo = attachment.mimeType.startsWith('video/');
  const blobUrl = useDecryptedBlob(
    attachment.url,
    attachment.blobKey,
    attachment.blobNonce,
    attachment.mimeType,
  );
  const [mediaFailed, setMediaFailed] = useState(false);
  useEffect(() => {
    setMediaFailed(false);
  }, [attachment.url, blobUrl]);
  const isNews = context === 'news';
  // Две парадигмы:
  //   • Chat (bubble) — `inline-flex w-fit` снаружи; tile shrink-wraps под
  //     media natural-width. `object-contain` без обрезки.
  //   • News — Apple/YouTube «ambient backdrop»: за основным media крутится
  //     его же копия с blur+scale, заполняя весь box карточки. Foreground
  //     — естественный aspect ratio с object-contain, без обрезки и без
  //     пустот по бокам. Vertical-видео аккуратно центрируется, фон —
  //     красивая размытая версия того же кадра.
  const wrapperClass = isNews ? 'block w-full' : '';
  const mediaSizing = isNews
    ? 'relative z-10 mx-auto block h-auto max-h-[540px] w-auto max-w-full object-contain'
    : 'block h-auto w-auto max-h-[420px] object-contain';

  if (isImage) {
    // Sync read natural dims из module-level cache (заполняется после первого
    // img.onload + persists в IDB через rebuild'ы). Если known → HTML5 атрибуты
    // width/height резервируют точный placeholder ДО async image-load →
    // scrollHeight стабилен с frame 1 → scroll-restore попадает в реальный
    // bottom/target → нет CLS jump'а при inter-chat switch.
    const rawDims = getDimsSync(attachment.url);
    const cachedDims =
      rawDims && rawDims.w >= 48 && rawDims.h >= 48 ? rawDims : null;
    const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>): void => {
      const img = e.currentTarget;
      setMediaFailed(false);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setDimsSync(attachment.url, img.naturalWidth, img.naturalHeight);
      }
    };
    const showMedia = !!blobUrl && !mediaFailed;
    return (
      <div
        className={cn(
          'group/img relative overflow-hidden rounded-lg',
          'border border-border-default bg-bg-primary',
          isNews ? 'block w-full' : 'inline-block',
          !isNews && showMedia && CHAT_MEDIA_MIN,
        )}
      >
        {showMedia ? (
          <>
            {isNews && (
              <AmbientBackdrop blobUrl={blobUrl} kind="image" />
            )}
            <a
              href={blobUrl}
              target={isNews ? undefined : '_blank'}
              rel="noreferrer"
              onClick={(e) => {
                if (isNews) e.preventDefault();
              }}
              onContextMenu={(e) => {
                if (isNews) e.preventDefault();
              }}
              draggable={!isNews}
              className={cn('block', isNews && 'select-none cursor-default')}
            >
              <img
                src={blobUrl}
                alt=""
                width={cachedDims?.w}
                height={cachedDims?.h}
                onLoad={handleImgLoad}
                onError={() => setMediaFailed(true)}
                className={mediaSizing}
              />
            </a>
            {!isNews && (
              <DownloadOverlayButton
                href={blobUrl}
                filename={attachment.filename}
                position="br"
              />
            )}
          </>
        ) : (
          <span
            className={cn(
              'flex h-32 w-full min-w-[200px] items-center justify-center text-text-muted',
              wrapperClass,
            )}
          >
            <ImageIcon className="h-5 w-5" strokeWidth={1.75} />
          </span>
        )}
      </div>
    );
  }

  if (isVideo) {
    return (
      <VideoTile
        blobUrl={blobUrl}
        filename={attachment.filename}
        context={context}
        wrapperClass={wrapperClass}
        mediaSizing={mediaSizing}
        onMediaError={() => setMediaFailed(true)}
        mediaFailed={mediaFailed}
      />
    );
  }

  const fileType = classifyFile(attachment.mimeType, attachment.filename);
  return (
    <a
      href={blobUrl ?? '#'}
      download={blobUrl ? attachment.filename : undefined}
      onClick={(e) => !blobUrl && e.preventDefault()}
      className={cn(
        'inline-flex items-center gap-2.5 rounded-lg',
        isNews ? 'max-w-[480px]' : 'max-w-[320px]',
        'border border-border-default bg-bg-primary px-2.5 py-2',
        'transition-colors',
        blobUrl ? 'cursor-pointer hover:border-border-strong' : 'cursor-default opacity-60',
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
          fileType.bg,
          fileType.fg,
        )}
      >
        <fileType.Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[12.5px] font-medium text-text-primary">
          {attachment.filename}
        </span>
        <span className="text-[10.5px] tabular-nums text-text-muted">
          {fileType.label}
          {fileType.label && ' · '}
          {formatBytes(attachment.size)}
        </span>
      </span>
    </a>
  );
}

interface FileTypeMeta {
  Icon: LucideIcon;
  label: string;
  bg: string;
  fg: string;
}

function classifyFile(mime: string, filename: string): FileTypeMeta {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (mime.includes('pdf') || ext === 'pdf') {
    return { Icon: FileType, label: 'PDF', bg: 'bg-danger/15', fg: 'text-danger' };
  }
  if (
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    ext === 'xls' ||
    ext === 'xlsx' ||
    ext === 'csv'
  ) {
    return {
      Icon: Sheet,
      label: ext.toUpperCase(),
      bg: 'bg-success/15',
      fg: 'text-success',
    };
  }
  if (
    mime.includes('word') ||
    mime.includes('officedocument.wordprocessingml') ||
    ext === 'doc' ||
    ext === 'docx' ||
    ext === 'rtf'
  ) {
    return {
      Icon: FileText,
      label: ext.toUpperCase(),
      bg: 'bg-blue-500/15',
      fg: 'text-blue-300',
    };
  }
  if (mime.includes('presentation') || ext === 'ppt' || ext === 'pptx') {
    return {
      Icon: FileImage,
      label: ext.toUpperCase(),
      bg: 'bg-amber-500/15',
      fg: 'text-amber-300',
    };
  }
  if (
    mime.includes('zip') ||
    mime.includes('rar') ||
    mime.includes('7z') ||
    mime.includes('tar') ||
    ext === 'zip' ||
    ext === 'rar' ||
    ext === '7z'
  ) {
    return {
      Icon: FileArchive,
      label: ext.toUpperCase(),
      bg: 'bg-purple-500/15',
      fg: 'text-purple-300',
    };
  }
  if (mime.startsWith('audio/')) {
    return {
      Icon: FileAudio,
      label: ext.toUpperCase() || 'AUDIO',
      bg: 'bg-accent-clay-bg',
      fg: 'text-accent-clay',
    };
  }
  if (mime.startsWith('video/')) {
    return {
      Icon: FileVideo,
      label: ext.toUpperCase() || 'VIDEO',
      bg: 'bg-accent-clay-bg',
      fg: 'text-accent-clay',
    };
  }
  if (mime.startsWith('image/')) {
    return {
      Icon: FileImage,
      label: ext.toUpperCase() || 'IMG',
      bg: 'bg-accent-clay-bg',
      fg: 'text-accent-clay',
    };
  }
  return {
    Icon: FileText,
    label: ext ? ext.toUpperCase() : '',
    bg: 'bg-accent-clay-bg',
    fg: 'text-accent-clay',
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}

/**
 * Глобальный bus для «только одно видео со звуком одновременно». Когда юзер
 * unmute'ит один тайл, он dispatch'ит event — остальные слушатели сразу
 * mute'ятся, чтобы не было «какафонии» из нескольких параллельных аудио.
 *
 * Module-level singleton — переживает re-mount'ы конкретных компонентов и не
 * требует React Context (избыточно для одного event).
 */
const videoAudioBus = new EventTarget();
const VIDEO_UNMUTE_EVENT = 'pyn:video-unmuted';

interface VideoTileProps {
  blobUrl: string | null;
  filename: string;
  context: AttachmentContext;
  /** Класс для wrapper-блока (news → block w-full; chat → пустой = inline). */
  wrapperClass: string;
  /** Классы для самого <video> (object-cover для news, object-contain для chat). */
  mediaSizing: string;
  mediaFailed?: boolean;
  onMediaError?: () => void;
}

/**
 * Видеоплеер с кастомными hover-controls (Telegram-style).
 *
 *   • Лента: muted + autoplay + loop + playsInline, без native controls.
 *   • Hover → 3 overlay-кнопки: mute(TR) / play(BL) / fullscreen(BR).
 *   • Click → play/pause.
 *   • `controlsList="nodownload noplaybackrate noremoteplayback"` —
 *     в native fullscreen UI скрывает кнопки «Скачать», «Скорость», «AirPlay»
 *     (Chromium это уважает).
 *   • `disablePictureInPicture` — отключает PiP-кнопку в fullscreen и
 *     native-меню (в news-context ниже это применяется жёстче).
 *   • News-режим: дополнительно блокируется правый-клик → «Сохранить видео».
 */
function VideoTile({
  blobUrl,
  filename,
  context,
  wrapperClass,
  mediaSizing,
  mediaFailed = false,
  onMediaError,
}: VideoTileProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const isNews = context === 'news';

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // Принудительно muted на mount — React muted-prop иногда игнорируется
    // браузером при autoplay'е, особенно после blob-URL load'a. Императивно
    // через DOM ref надёжнее. Стейт sync'аем явно: volumechange event на blob-
    // URL'ах летит ненадёжно (chromium иногда дропает) — UI должен обновляться
    // именно от наших toggle-функций, не полагаемся на DOM-events.
    v.muted = true;
    setIsMuted(true);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    // 🔴 fullscreenchange event летит ВСЕМ слушателям документа. Если в
    //   ленте 3 видео, и юзер открывает fullscreen на одном — каждый VideoTile
    //   получит event. Без явной привязки «это моё видео сейчас в fullscreen?»
    //   все 3 unmute-ятся → каша из аудио. Проверяем `fullscreenElement === v`.
    const onFullscreenChange = () => {
      if (document.fullscreenElement === v) {
        // Это видео — на весь экран. Unmute, юзер слышит звук. Параллельно
        // глушим всех соседей через bus — fullscreen у одного видео должен
        // эксклюзивно владеть звуком.
        v.muted = false;
        setIsMuted(false);
        videoAudioBus.dispatchEvent(
          new CustomEvent<HTMLVideoElement>(VIDEO_UNMUTE_EVENT, { detail: v }),
        );
      } else {
        // Любое другое состояние (выход из fullscreen, fullscreen у соседа) —
        // строго mute. Даже если события fullscreenchange срабатывают не по
        // нам, мы остаёмся тихими.
        v.muted = true;
        setIsMuted(true);
        if (v.paused) v.play().catch(() => undefined);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    // Mutual-exclusion аудио: если другое видео unmute'ится — глушим себя
    // (только если играем — fullscreen-видео под себя сам этот event не шлёт).
    const onOtherUnmuted = (e: Event) => {
      const detail = (e as CustomEvent<HTMLVideoElement>).detail;
      if (detail === v) return;
      if (v.muted) return;
      v.muted = true;
      setIsMuted(true);
    };
    videoAudioBus.addEventListener(VIDEO_UNMUTE_EVENT, onOtherUnmuted);
    // Off-screen auto-mute: rAF-throttled scroll listener + getBoundingClientRect.
    // IntersectionObserver не сработал надёжно для вложенных scroll-контейнеров
    // ленты/чата — события не приходили на parent scroll, только на window-scroll.
    // Прямой rect-чек работает всегда: верх рабочей зоны = TOP_GUARD от viewport-
    // top (топ-бар ~48px), низ = винду-height − BOTTOM_GUARD (floating composer
    // ~80px). Как только video.bottom < topGuard ИЛИ video.top > bottomGuard
    // ИЛИ visible высота < 80% от height — звук глушим (но играть продолжаем).
    // В fullscreen не вмешиваемся.
    const TOP_GUARD = 56;
    const BOTTOM_GUARD = 96;
    const checkOffscreen = (): void => {
      if (document.fullscreenElement === v) return;
      if (v.muted) return; // уже muted — нет нужды дёргать setState
      const r = v.getBoundingClientRect();
      if (r.height === 0) return;
      const winH = window.innerHeight;
      const topClip = Math.max(r.top, TOP_GUARD);
      const botClip = Math.min(r.bottom, winH - BOTTOM_GUARD);
      const visible = Math.max(0, botClip - topClip);
      // Глушим как только >20% видео уехало за рабочую зону. Меньший порог
      // даёт мгновенную реакцию даже при частичном перекрытии композером.
      if (visible < r.height * 0.8) {
        v.muted = true;
        setIsMuted(true);
      }
    };
    let rafPending = false;
    const onScrollOrResize = (): void => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        checkOffscreen();
      });
    };
    // Ищем все scroll-ancestor'ы (overflowY: auto/scroll/overlay) и навешиваем
    // listener на каждый — внутренний scroll-контейнер ленты НЕ пробрасывает
    // event на window. Capture-phase не нужна: scroll bubble не работает,
    // но direct listener на каждом scroll-parent ловит native scroll event.
    const scrollParents: (HTMLElement | Window)[] = [window];
    let parent: HTMLElement | null = v.parentElement;
    while (parent) {
      const style = window.getComputedStyle(parent);
      if (/(auto|scroll|overlay)/.test(style.overflowY)) scrollParents.push(parent);
      parent = parent.parentElement;
    }
    for (const sp of scrollParents) {
      sp.addEventListener('scroll', onScrollOrResize, { passive: true });
    }
    window.addEventListener('resize', onScrollOrResize, { passive: true });
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      videoAudioBus.removeEventListener(VIDEO_UNMUTE_EVENT, onOtherUnmuted);
      for (const sp of scrollParents) {
        sp.removeEventListener('scroll', onScrollOrResize);
      }
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => undefined);
    else v.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    // Sync state явно — volumechange event на blob-URL'ах ненадёжен и иконка
    // зависала на VolumeX даже после v.muted=false. Имперически меняем оба
    // одновременно: и DOM, и React-state.
    const next = !v.muted;
    v.muted = next;
    setIsMuted(next);
    // Включили звук → сообщаем остальным VideoTile'ам, чтобы они себя
    // muted'или. Один звук одновременно — никакой какафонии в ленте/чате.
    if (!next) {
      videoAudioBus.dispatchEvent(
        new CustomEvent<HTMLVideoElement>(VIDEO_UNMUTE_EVENT, { detail: v }),
      );
    }
  }, []);

  const enterFullscreen = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.requestFullscreen?.().catch(() => undefined);
  }, []);

  const showMedia = !!blobUrl && !mediaFailed;

  return (
    <div
      className={cn(
        'group/video relative overflow-hidden rounded-lg',
        'border border-border-default bg-bg-primary',
        isNews ? 'block w-full' : 'inline-block',
        !isNews && showMedia && CHAT_MEDIA_MIN,
        wrapperClass,
      )}
    >
      {showMedia ? (
        <>
          {isNews && <AmbientBackdrop blobUrl={blobUrl} kind="video" />}
          <video
            ref={videoRef}
            src={blobUrl}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onError={() => onMediaError?.()}
            controlsList={
              isNews
                ? 'nodownload noplaybackrate noremoteplayback nofullscreen'
                : 'nodownload noplaybackrate'
            }
            disablePictureInPicture={isNews}
            disableRemotePlayback={isNews}
            onClick={togglePlay}
            onContextMenu={(e) => {
              if (isNews) e.preventDefault();
            }}
            draggable={!isNews}
            className={cn('cursor-pointer', mediaSizing, isNews && 'select-none')}
          />
          <VideoCtl
            position="tr"
            onClick={toggleMute}
            label={isMuted ? t('attachments.unmute') : t('attachments.mute')}
            icon={isMuted ? VolumeX : Volume2}
          />
          <VideoCtl
            position="bl"
            onClick={togglePlay}
            label={isPlaying ? t('attachments.pause') : t('attachments.play')}
            icon={isPlaying ? Pause : Play}
          />
          <VideoCtl
            position="br"
            onClick={enterFullscreen}
            label={t('attachments.fullscreen')}
            icon={Maximize}
          />
          {!isNews && blobUrl && (
            <DownloadOverlayButton
              href={blobUrl}
              filename={filename}
              position="tl"
            />
          )}
        </>
      ) : (
        <span className="flex h-32 w-full min-w-[200px] items-center justify-center text-text-muted">
          <Play className="h-5 w-5" strokeWidth={1.75} />
        </span>
      )}
    </div>
  );
}

interface AmbientBackdropProps {
  blobUrl: string;
  kind: 'image' | 'video';
}

/**
 * «Ambient backdrop» (Apple TV / YouTube): за основным media рендерится его
 * же копия c сильным `blur` + `scale`, заполняя весь box карточки. Это
 * решает дилемму broadcast-feed:
 *   • Растянуть vertical-шортс на full-width → object-cover крадёт половину
 *     кадра.
 *   • Center vertical с естественным aspect → пустые тёмные полосы по бокам.
 *
 * Ambient: vertical media сидит по центру естественной шириной, а полосы
 * заполнены красивой размытой версией того же кадра. Видно всё, нигде нет
 * пустоты, vertical и horizontal media в feed'е смотрятся одинаково ровно.
 *
 * Performance: тот же `blobUrl` — браузер cache'ит decode'нутые байты;
 * фоновое видео muted+playsInline, без overhead'a звука.
 */
function AmbientBackdrop({ blobUrl, kind }: AmbientBackdropProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // 🔴 Backdrop НИКОГДА не должен звучать. React `muted` prop иногда игнорим
  //   браузером для autoplay-видео. Императивно блокируем audio через ref:
  //   muted=true + volume=0. Также `defaultMuted` HTML-атрибут — для cases
  //   когда video element создаётся через innerHTML/SSR.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.volume = 0;
  }, []);
  const common =
    'absolute inset-0 z-0 h-full w-full object-cover scale-110 blur-2xl opacity-60';
  if (kind === 'video') {
    return (
      <video
        ref={videoRef}
        src={blobUrl}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden
        tabIndex={-1}
        className={common}
      />
    );
  }
  return <img src={blobUrl} alt="" aria-hidden className={common} />;
}

interface DownloadOverlayButtonProps {
  href: string;
  filename: string;
  /** Угол overlay'a. tl/tr/bl/br. */
  position: 'tl' | 'tr' | 'bl' | 'br';
}

/**
 * Overlay-кнопка скачивания поверх media-тайла (Telegram-style). Видна только
 * при hover на тайл. Использует HTML5 `<a download>` — браузер сам предлагает
 * сохранить blob под именем `filename`. Только для chat-context (в news
 * download заблокирован выше).
 */
function DownloadOverlayButton({
  href,
  filename,
  position,
}: DownloadOverlayButtonProps) {
  const { t } = useTranslation();
  const posClass =
    position === 'tl'
      ? 'left-2 top-2'
      : position === 'tr'
        ? 'right-2 top-2'
        : position === 'bl'
          ? 'left-2 bottom-2'
          : 'right-2 bottom-2';
  return (
    <a
      href={href}
      download={filename}
      onClick={(e) => e.stopPropagation()}
      aria-label={t('attachments.download_aria')}
      title={t('attachments.download_aria')}
      className={cn(
        'absolute z-10',
        posClass,
        'flex h-7 w-7 items-center justify-center rounded-full',
        'bg-bg-deep/65 text-white backdrop-blur-[2px] outline-none',
        'opacity-0 transition-opacity duration-150',
        'group-hover/img:opacity-100 group-hover/video:opacity-100 hover:bg-bg-deep/85',
      )}
    >
      <Download className="h-3.5 w-3.5" strokeWidth={2} />
    </a>
  );
}

interface VideoCtlProps {
  position: 'tr' | 'bl' | 'br';
  onClick: () => void;
  label: string;
  icon: typeof Play;
}

function VideoCtl({ position, onClick, label, icon: Icon }: VideoCtlProps) {
  const posClass =
    position === 'tr'
      ? 'right-2 top-2'
      : position === 'bl'
        ? 'left-2 bottom-2'
        : 'right-2 bottom-2';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className={cn(
        'absolute z-10',
        posClass,
        'flex h-7 w-7 items-center justify-center rounded-full',
        'bg-bg-deep/65 text-white backdrop-blur-[2px] outline-none',
        'opacity-0 transition-opacity duration-150',
        'group-hover/video:opacity-100 hover:bg-bg-deep/85',
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  );
}
