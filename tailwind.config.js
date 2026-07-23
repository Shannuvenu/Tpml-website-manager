/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Dark IDE-inspired palette — not the templated black+neon default,
        // tuned closer to editor chrome (slate) with a single indigo accent
        // used only for interactive/active states.
        canvas: '#0d1117',      // page background
        panel: '#11161d',       // sidebar / editor chrome
        panelAlt: '#161b22',    // header / status bar
        border: '#232a34',
        text: {
          primary: '#e6edf3',
          secondary: '#8b949e',
          muted: '#5b6470',
        },
        accent: {
          DEFAULT: '#5b8def',
          hover: '#4a7cdb',
          muted: '#243b5e',
        },
        success: '#3fb950',
        warning: '#d29922',
        danger: '#f85149',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
