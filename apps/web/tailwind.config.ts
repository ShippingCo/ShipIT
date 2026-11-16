import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

/*
  Tailwind is here to run components from the 21st.dev / shadcn ecosystem. It sits
  ALONGSIDE the hand-written M3 layer in src/styles rather than replacing it, so:

  - preflight is OFF. base.css already carries a full reset, and Tailwind's would
    clobber it — it resets `a` to `color: inherit`, which would flatten every link in
    the app. The one part of preflight shadcn genuinely needs (border defaults) is
    reproduced by hand in tailwind.css.
  - every colour resolves to a CSS variable that is bridged to a ShippingCo M3 token
    in tailwind.css, so an imported component inherits this app's palette instead of
    dragging in a second, competing one.
*/

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
  	extend: {
  		fontFamily: {
  			sans: [
  				'Inter',
  				'-apple-system',
  				'Segoe UI',
  				'Roboto',
  				'sans-serif'
  			]
  		},
  		colors: {
  			border: 'hsl(var(--sc-border))',
  			input: 'hsl(var(--sc-input))',
  			ring: 'hsl(var(--sc-ring))',
  			background: 'hsl(var(--sc-background))',
  			foreground: 'hsl(var(--sc-foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--sc-primary))',
  				foreground: 'hsl(var(--sc-primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--sc-secondary))',
  				foreground: 'hsl(var(--sc-secondary-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--sc-destructive))',
  				foreground: 'hsl(var(--sc-destructive-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--sc-muted))',
  				foreground: 'hsl(var(--sc-muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--sc-accent))',
  				foreground: 'hsl(var(--sc-accent-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--sc-popover))',
  				foreground: 'hsl(var(--sc-popover-foreground))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--sc-card))',
  				foreground: 'hsl(var(--sc-card-foreground))'
  			},
  			success: {
  				DEFAULT: 'hsl(var(--sc-success))',
  				foreground: 'hsl(var(--sc-success-foreground))'
  			},
  			warning: {
  				DEFAULT: 'hsl(var(--sc-warning))',
  				foreground: 'hsl(var(--sc-warning-foreground))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--sc-radius)',
  			md: 'calc(var(--sc-radius) - 4px)',
  			sm: 'calc(var(--sc-radius) - 8px)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
