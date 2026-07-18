import type { ReactNode } from 'react';

export const metadata = {
  title: 'Orchestra',
  description: 'Conducting Score UI',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
