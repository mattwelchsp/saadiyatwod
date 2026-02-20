import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Saadiyat WOD',
  description: 'A premium daily workout dashboard inspired by island training culture.'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
