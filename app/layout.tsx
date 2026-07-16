import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "开发面试数字人",
  description: "服务交付型 AI 数字人面试训练 MVP"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
