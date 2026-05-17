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
        'presence-away':     '#E5A83B',
        'presence-offline':  '#E57373',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI Variable', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'pill': '999px',
      },
    },
  },
  plugins: [],
} satisfies Config;
