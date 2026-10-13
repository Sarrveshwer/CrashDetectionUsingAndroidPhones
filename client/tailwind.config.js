/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        emergency: {
          red: '#dc2626',
          blue: '#1d4ed8',
        }
      }
    },
  },
  plugins: [],
}
