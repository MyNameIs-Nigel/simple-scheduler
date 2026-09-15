import type { ReactNode } from "react";

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mx-auto w-full max-w-[1024px] px-6 min-[1072px]:px-0 ${className}`.trim()}>{children}</div>
  );
}
