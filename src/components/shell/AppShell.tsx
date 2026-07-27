import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <Topbar />
        <main className="flex-1">
          <div className="mx-auto w-full max-w-[1480px] px-4 md:px-6 lg:px-[38px] py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
