export const metadata = {
  title: 'Rate Limiter Demo - Next.js 16',
  description: 'Distributed rate limiting with bun-rate-limiter',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
