import type { ReactNode } from "react";

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mx-auto w-full max-w-[768px] px-6 min-[816px]:px-0 ${className}`.trim()}>{children}</div>
  );
}
