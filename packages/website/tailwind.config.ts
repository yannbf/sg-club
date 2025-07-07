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
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          background: 'var(--card-background)',
          border: 'var(--card-border)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
          blue: 'var(--accent-blue)',
          purple: 'var(--accent-purple)',
          green: 'var(--accent-green)',
          yellow: 'var(--accent-yellow)',
          red: 'var(--accent-red)',
          orange: 'var(--accent-orange)',
        },
        success: {
          DEFAULT: 'var(--success)',
          foreground: 'var(--success-foreground)',
          light: 'var(--success-light)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          foreground: 'var(--warning-foreground)',
          light: 'var(--warning-light)',
        },
        error: {
          DEFAULT: 'var(--error)',
          foreground: 'var(--error-foreground)',
          light: 'var(--error-light)',
        },
        info: {
          DEFAULT: 'var(--info)',
          foreground: 'var(--info-foreground)',
          light: 'var(--info-light)',
        },
      },
    },
  },
  plugins: [],
}

export default config
