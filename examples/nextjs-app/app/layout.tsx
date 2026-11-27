// The only NEVERHELD change to this app: one script tag at the end of <body>.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <script src="/neverheld/neverheld.min.js" data-auto-seal data-application="Next.js fixture" data-workers-network="none" />
      </body>
    </html>
  );
}
