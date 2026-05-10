import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        display: [
          'var(--font-display)',
          'var(--font-sans)',
          'Inter',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          'var(--font-mono)',
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'monospace',
        ],
      },
      colors: {
        accent: 'var(--accent)',
        'accent-foreground': 'var(--accent-foreground)',
        'accent-hover': 'var(--accent-hover)',
        'accent-green': 'var(--accent-green)',
        'accent-yellow': 'var(--accent-yellow)',
        'accent-orange': 'var(--accent-orange)',
        'accent-blue': 'var(--accent-blue)',
        'accent-purple': 'var(--accent-purple)',
        'accent-red': 'var(--accent-red)',
        'accent-rose': 'var(--accent-rose)',
        primary: 'var(--primary)',
        'primary-foreground': 'var(--primary-foreground)',
        'primary-hi': 'var(--primary-hi)',
        background: 'var(--background)',
        'background-elevated': 'var(--background-elevated)',
        foreground: 'var(--foreground)',
        'card-background': 'var(--card-background)',
        'card-background-hover': 'var(--card-background-hover)',
        'card-border': 'var(--card-border)',
        'card-border-strong': 'var(--card-border-strong)',
        muted: 'var(--muted)',
        'muted-foreground': 'var(--muted-foreground)',
        subtle: 'var(--subtle)',
        success: 'var(--success)',
        'success-foreground': 'var(--success-foreground)',
        'success-light': 'var(--success-light)',
        error: 'var(--error)',
        'error-foreground': 'var(--error-foreground)',
        'error-light': 'var(--error-light)',
        info: 'var(--info)',
        'info-foreground': 'var(--info-foreground)',
        'info-light': 'var(--info-light)',
        warning: 'var(--warning)',
        'warning-foreground': 'var(--warning-foreground)',
        'warning-light': 'var(--warning-light)',
      },
      borderColor: {
        problem: 'var(--card-border-problem)',
        warning: 'var(--card-border-warning)',
        info: 'var(--card-border-info)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'zoom-in': {
          '0%': { transform: 'scale(0.95)' },
          '100%': { transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-in-out',
        'zoom-in': 'zoom-in 0.2s ease-in-out',
        shimmer: 'shimmer 1.4s linear infinite',
      },
    },
  },
  plugins: [],
}
export default config
