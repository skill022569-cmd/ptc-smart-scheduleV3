import './globals.css';

export const metadata = {
  title: 'PTC Smart Schedule · วิทยาลัยการอาชีพโพนทอง',
  description: 'ระบบตารางเรียน-ตารางสอน วิทยาลัยการอาชีพโพนทอง',
  icons: { icon: '/logo.webp' },
};
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
