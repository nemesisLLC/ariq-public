import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = {title:'ARIQ — Water connects us',description:'An irrigation planning experience, beginning in Samarkand, Uzbekistan.'};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><head>
  <link rel="preload" as="image" href="/media/registan/preview-instant-v1.avif" media="(min-width: 601px)" fetchPriority="high"/>
  <link rel="preload" as="image" href="/media/registan/preview-mobile-instant-v1.avif" media="(max-width: 600px)" fetchPriority="high"/>
</head><body>{children}</body></html>}
