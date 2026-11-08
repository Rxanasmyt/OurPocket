/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html'],
  theme: {
    extend: {
      fontFamily: { sans: ['Prompt', 'sans-serif'] },
      colors: { primary: '#ff4d6d', secondary: '#ffb3c1', income: '#10b981', expense: '#ef4444' },
      spacing: { 'safe-top': 'env(safe-area-inset-top)', 'safe-bottom': 'env(safe-area-inset-bottom)' }
    }
  }
};
