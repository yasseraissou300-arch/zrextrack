import React from 'react';
import Sidebar from './Sidebar';
import { ChatbotProvider } from '@/contexts/ChatbotContext';
import ChatbotDrawer from './ChatbotDrawer';

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <ChatbotProvider>
      <div className="flex h-screen bg-gray-50 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          {children}
        </main>
      </div>
      <ChatbotDrawer />
    </ChatbotProvider>
  );
}
