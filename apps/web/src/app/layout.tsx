import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { QueryProvider } from '@/providers/query-provider';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Orchestra — Conducting Score',
  description: 'Conducting Score UI для управления GSD-сессиями',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <QueryProvider>
          <main className="min-h-screen bg-background p-8">
            <div className="mx-auto max-w-3xl">
              <h1 className="text-2xl font-bold mb-6">Orchestra</h1>
              {children}
            </div>
          </main>
          <Toaster />
        </QueryProvider>
      </body>
    </html>
  );
}
