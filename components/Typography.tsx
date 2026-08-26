import type { ReactNode } from "react";

function headingClass(extra: string) {
  return `tracking-tight leading-tight text-fg ${extra}`.trim();
}

export function H1({ children, className = "", firstOnPage = false }: { children: ReactNode; className?: string; firstOnPage?: boolean }) {
  return <h1 className={headingClass(`${firstOnPage ? "mb-4" : "mt-12 mb-4"} text-3xl font-bold ${className}`)}>{children}</h1>;
}

export function H2({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <h2 id={id} className={headingClass(`mt-10 mb-3 text-2xl font-semibold ${className}`)}>
      {children}
    </h2>
  );
}

export function H3({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h3 className={headingClass(`mt-8 mb-2 text-xl font-semibold ${className}`)}>{children}</h3>;
}

export function H4({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h4 className={headingClass(`mt-6 mb-2 text-lg font-medium ${className}`)}>{children}</h4>;
}

export function Paragraph({ children, className = "", muted = false }: { children: ReactNode; className?: string; muted?: boolean }) {
  return (
    <p className={`mb-4 text-base leading-relaxed ${muted ? "text-muted" : "text-fg"} ${className}`.trim()}>{children}</p>
  );
}
