import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
          strong: 'hsl(var(--primary-strong) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        amber: {
          DEFAULT: 'hsl(var(--amber) / <alpha-value>)',
          soft: 'hsl(var(--amber-soft) / <alpha-value>)',
        },
        cyan: {
          DEFAULT: 'hsl(var(--cyan) / <alpha-value>)',
          soft: 'hsl(var(--cyan-soft) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          foreground: 'hsl(var(--success-foreground) / <alpha-value>)',
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-xs)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        '3xl': 'var(--radius-3xl)',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        lift: 'var(--shadow-lift)',
        glow: 'var(--shadow-glow)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'system-ui', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Consolas', 'monospace'],
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'pop-in': { from: { opacity: '0', scale: '0.94' }, to: { opacity: '1', scale: '1' } },
        'pop-out': { from: { opacity: '1', scale: '1' }, to: { opacity: '0', scale: '0.96' } },
        'dialog-in': {
          from: { opacity: '0', scale: '0.96', translate: '0 10px' },
          to: { opacity: '1', scale: '1', translate: '0 0' },
        },
        'dialog-out': { from: { opacity: '1', scale: '1' }, to: { opacity: '0', scale: '0.97' } },
        'toast-in': {
          from: { opacity: '0', translate: 'calc(100% + 1rem) 0' },
          to: { opacity: '1', translate: '0 0' },
        },
        'toast-out': { from: { opacity: '1', translate: '0 0' }, to: { opacity: '0', translate: '30% 0' } },
        'tab-in': { from: { opacity: '0', translate: '0 6px' }, to: { opacity: '1', translate: '0 0' } },
        pulsering: {
          '0%': { boxShadow: '0 0 0 0 hsl(var(--cyan) / 0.5)' },
          '100%': { boxShadow: '0 0 0 14px hsl(var(--cyan) / 0)' },
        },
        shake: {
          '0%, 100%': { translate: '0 0' },
          '25%': { translate: '-4px 0' },
          '75%': { translate: '4px 0' },
        },
        flash: { '0%': { opacity: '0.9' }, '100%': { opacity: '0' } },
        meter: { from: { transform: 'scaleX(0)' }, to: { transform: 'scaleX(1)' } },
        float: { '0%, 100%': { translate: '0 0' }, '50%': { translate: '0 -6px' } },
        spinslow: { to: { rotate: '360deg' } },
      },
      animation: {
        rise: 'rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        fade: 'fade 0.22s ease-out both',
        'fade-out': 'fade-out 0.18s ease-in both',
        'pop-in': 'pop-in 0.2s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pop-out': 'pop-out 0.12s ease-in both',
        'dialog-in': 'dialog-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
        'dialog-out': 'dialog-out 0.16s ease-in both',
        'toast-in': 'toast-in 0.42s cubic-bezier(0.22, 1, 0.36, 1) both',
        'toast-out': 'toast-out 0.2s ease-in both',
        'tab-in': 'tab-in 0.32s cubic-bezier(0.22, 1, 0.36, 1) backwards',
        'pulse-ring': 'pulsering 1.1s ease-out infinite',
        shake: 'shake 0.3s ease-in-out both',
        flash: 'flash 0.5s ease-out both',
        meter: 'meter 0.6s cubic-bezier(0.22, 1, 0.36, 1) both',
        float: 'float 5s ease-in-out infinite',
        'spin-slow': 'spinslow 12s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config
