import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import DarkSidebar from "@/components/layout/DarkSidebar";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BGO Report Factory",
  description: "Self-service BI reporting for operations teams",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-[#F4F6FA] flex">
        <DarkSidebar />
        <div className="ml-[220px] flex-1 min-h-screen overflow-auto">
          {children}
        </div>
      </body>
    </html>
  );
}
