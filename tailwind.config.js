/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // SocialPings design tokens — presence, not performance
        ping: {
          here: '#6366f1',          // indigo — presence
          'check-this': '#f59e0b',  // amber — share
          'thinking-of-you': '#ec4899', // pink — relationship
          'lets-connect': '#10b981',    // emerald — invitation
          status: '#3b82f6',            // blue — state
        },
        trust: {
          close: '#10b981',
          contact: '#6366f1',
          discoverable: '#94a3b8',
          guardian: '#f59e0b',
        },
      },
    },
  },
  plugins: [],
}
