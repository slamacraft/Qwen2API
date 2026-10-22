/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#f6f7f9',
        surface: '#ffffff',
        line: '#e6e8ec',
        ink: {
          DEFAULT: '#111827',
          soft: '#4b5563',
          mute: '#9ca3af',
        },
        brand: {
          50: '#eff4ff',
          100: '#dbe6fe',
          200: '#bfd3fe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        ok: {
          50: '#ecfdf3',
          100: '#d1fadf',
          600: '#039855',
          700: '#027a48',
        },
        warn: {
          50: '#fffaeb',
          100: '#fef0c7',
          600: '#dc6803',
          700: '#b54708',
        },
        danger: {
          50: '#fef3f2',
          100: '#fee4e2',
          200: '#fecdca',
          600: '#d92d20',
          700: '#b42318',
        },
      },
      borderRadius: {
        card: '12px',
        control: '8px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,0.06)',
        pop: '0 12px 32px rgba(16,24,40,0.12)',
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'sans-serif',
        ],
        mono: ['SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
