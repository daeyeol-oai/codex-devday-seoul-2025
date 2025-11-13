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
  title: '꿈 스케치 스튜디오',
  description: '스케치와 글을 올리고 이미지를 만든 뒤 소라 비디오까지 이어지는 창작 놀이터.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='ko'>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}> 
        <div className='flex min-h-screen bg-[var(--background)] text-[var(--foreground)]'>
          <main className='flex-1'>{children}</main>
          <SidePanel />
        </div>
      </body>
    </html>
  );
}
