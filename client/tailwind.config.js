/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Status palette — matches the tracker states.
        to_apply: { bg: '#fef3c7', text: '#92400e', dot: '#f59e0b' },
        applied: { bg: '#dbeafe', text: '#1e3a8a', dot: '#3b82f6' },
        interviewing: { bg: '#dcfce7', text: '#166534', dot: '#22c55e' },
        new_badge: { bg: '#fee2e2', text: '#991b1b', dot: '#ef4444' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
