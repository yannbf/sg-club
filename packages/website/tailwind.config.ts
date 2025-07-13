import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-green': 'var(--accent-green)',
        'accent-green-foreground': 'var(--accent-green-foreground)',
        'accent-yellow': 'var(--accent-yellow)',
        'accent-yellow-foreground': 'var(--accent-yellow-foreground)',
        'accent-orange': 'var(--accent-orange)',
        'accent-orange-foreground': 'var(--accent-orange-foreground)',
        'accent-blue': 'var(--accent-blue)',
        'accent-blue-foreground': 'var(--accent-blue-foreground)',
        'accent-purple': 'var(--accent-purple)',
        'accent-purple-foreground': 'var(--accent-purple-foreground)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        'card-background': 'var(--card-background)',
        'card-border': 'var(--card-border)',
        muted: 'var(--muted)',
        'muted-foreground': 'var(--muted-foreground)',
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
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'zoom-in': {
          '0%': { transform: 'scale(0.95)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-in-out',
        'zoom-in': 'zoom-in 0.2s ease-in-out',
      },
    },
  },
  plugins: [],
}
export default config
