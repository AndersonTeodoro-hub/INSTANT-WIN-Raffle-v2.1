/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./pages/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Space Grotesk', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: '#F59E0B', // Amber 500 (Gold)
          glow: 'rgba(245, 158, 11, 0.3)',
        },
        action: {
          DEFAULT: '#2563EB', // Blue 600
          hover: '#1d4ed8',
        },
        success: {
          DEFAULT: '#22C55E', // Green 500
          hover: '#16a34a',
        },
        dark: {
          bg: '#000000',     // Pure Black
          card: '#0F0F11',   // Dark Gray Card
          border: '#1E1E22', // Subtle Border
          input: '#18181B',  // Input Background
        }
      },
      backgroundImage: {
        'gradient-banner': 'linear-gradient(135deg, #2563EB 0%, #7C3AED 100%)', // Blue to Purple
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.5s ease-out',
        'shimmer': 'shimmer 2s infinite',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
    },
  },
  plugins: [],
}