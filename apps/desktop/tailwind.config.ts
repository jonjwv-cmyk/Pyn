import type { Config } from 'tailwindcss';

/**
 * Tailwind theme — warm-dark палитра Pyn (semantic tokens).
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-primary':   '#262624',
        'bg-surface':   '#1F1E1B',
        'bg-elevated':  '#302F2D',
        'bg-deep':      '#161611',
        'bg-hover':     'rgba(255,255,255,0.08)',
        'bg-pressed':   'rgba(255,255,255,0.12)',
        'bg-selected':  'rgba(217,119,87,0.08)',

        'text-strong':       '#F5F4EF',
        'text-primary':      '#E5E5E2',
        'text-description':  '#CECCC5',
        'text-secondary':    '#B8B5A9',
        'text-muted':        '#A6A39B',

        'border-subtle':  'rgba(234,221,216,0.10)',
        'border-default': 'rgba(108,106,96,0.25)',
        'border-strong':  'rgba(108,106,96,0.58)',

        'accent-clay':       '#D97757',
        'accent-clay-dim':   '#B35E45',
        'accent-clay-bg':    'rgba(217,119,87,0.16)',

        'brand-kraft':       '#D4A37F',
        'brand-bookcloth':   '#CC785C',
        'brand-manilla':     '#E9D7B3',

        'danger':   '#E57373',
        'success':  '#7DC061',

        'presence-online':   '#7DC061',
        // §pyn-1.2.36 — yellow ярче (#FFB72B вместо #E5A83B), не выглядит
        // «прозрачным» на dark theme рядом с тёмным ring.
        'presence-away':     '#FFB72B',
        'presence-offline':  '#E57373',
      },
      fontFamily: {
        // font-sans = выбранный в Настройках шрифт (CSS-переменная --app-font,
        // см. app-font.ts), системный стек — fallback пока шрифт не применён.
        sans: ['var(--app-font)', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI Variable', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'pill': '999px',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        // Хаотичный mesh-градиент внутри AI-пилюли: несколько цветных источников
        // (из центра, боков, углов) плавно блуждают по всей площади — каждый слой
        // двигается своим путём (анимируем background-position по 5 слоям).
        mesh: {
          '0%, 100%': { backgroundPosition: '15% 20%, 85% 18%, 45% 85%, 92% 72%, 22% 78%' },
          '25%': { backgroundPosition: '50% 55%, 60% 45%, 18% 48%, 72% 28%, 58% 35%' },
          '50%': { backgroundPosition: '80% 32%, 22% 72%, 82% 22%, 30% 82%, 40% 55%' },
          '75%': { backgroundPosition: '34% 76%, 70% 60%, 55% 38%, 58% 50%, 76% 64%' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.8s linear infinite',
        mesh: 'mesh 15s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
