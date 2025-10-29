import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import SidePanel from '@/app/components/SidePanel'

import '@/styles/theme.css'
import './globals.css'

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: 'Building Stories',
  description: 'Upload sketches, generate images, and craft a Sora video.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en'>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}> 
        <div className='flex min-h-screen bg-[var(--background)] text-[var(--foreground)]'>
          <main className='flex-1'>{children}</main>
          <SidePanel />
        </div>
      </body>
    </html>
  );
}
