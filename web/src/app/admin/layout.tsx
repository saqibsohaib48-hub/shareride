'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/lib/app-context';
import { RequireAuth } from '@/components/ui';

const LINKS = [['/admin', 'Dashboard'], ['/admin/pricing', 'Pricing'], ['/admin/countries', 'Countries'], ['/admin/users', 'Users'], ['/admin/rides', 'Rides'], ['/admin/support', 'Support'], ['/admin/audit', 'Audit log']] as const;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { me } = useApp();
  const path = usePathname();
  return (
    <RequireAuth>
      {!me?.adminRole ? (
        // UI gate only — every admin API independently enforces role permissions server-side.
        <div className="alert error" role="alert">You don't have access to the admin dashboard.</div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row between"><h1 style={{ margin: 0 }}>Admin</h1><span className="pill brand">{me.adminRole}</span></div>
          <nav className="tabs" aria-label="Admin">
            {LINKS.map(([href, label]) => <Link key={href} href={href}><button role="tab" aria-selected={path === href}>{label}</button></Link>)}
          </nav>
          {children}
        </div>
      )}
    </RequireAuth>
  );
}
