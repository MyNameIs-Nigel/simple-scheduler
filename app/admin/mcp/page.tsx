import { desc, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mcpAuditLogs, mcpClients, mcpRefreshTokens } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/dal";
import { mcpEnabled, siteUrl, timezone } from "@/lib/env";
import { DateTime } from "luxon";
import { pruneMcpOAuthAction, revokeMcpFamilyAction } from "../actions";

export const metadata = { title: "MCP & Grants — Admin" };

export default async function McpAdminPage() {
  await requireAdmin();
  const enabled = mcpEnabled();
  const zone = timezone();

  const clients = await db
    .select()
    .from(mcpClients)
    .orderBy(desc(mcpClients.createdAt))
    .limit(20);

  const activeGrants = await db
    .select()
    .from(mcpRefreshTokens)
    .where(isNull(mcpRefreshTokens.revokedAt))
    .orderBy(desc(mcpRefreshTokens.createdAt))
    .limit(50);

  const auditLogs = await db
    .select()
    .from(mcpAuditLogs)
    .orderBy(desc(mcpAuditLogs.createdAt))
    .limit(50);

  const clientMap = new Map<string, string>();
  for (const c of clients) {
    clientMap.set(c.id, c.clientName ?? c.id);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-mono text-base font-semibold text-fg">
            Model Context Protocol (MCP) Server
          </h2>
          <p className="mt-1 text-xs text-muted">
            Status:{" "}
            <span
              className={`font-mono font-medium ${
                enabled ? "text-accent-4" : "text-red-400"
              }`}
            >
              {enabled ? "ENABLED (/mcp)" : "DISABLED (MCP_ENABLED=false)"}
            </span>
          </p>
          <p className="mt-0.5 font-mono text-xs text-muted">
            Connector URL: {siteUrl()}/mcp
          </p>
        </div>

        <form action={pruneMcpOAuthAction}>
          <button
            type="submit"
            className="rounded-lg border border-border px-3 py-1.5 font-mono text-xs text-muted transition-colors hover:border-accent-1/50 hover:text-fg"
          >
            Prune Expired Data
          </button>
        </form>
      </div>

      {/* Active Grants */}
      <section className="mb-10">
        <h3 className="mb-3 font-mono text-xs uppercase tracking-widest text-muted">
          Active Grants ({activeGrants.length})
        </h3>
        {activeGrants.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
            No active OAuth grants found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-surface-raised font-mono text-muted">
                <tr>
                  <th className="px-4 py-2.5">Client</th>
                  <th className="px-4 py-2.5">Family ID</th>
                  <th className="px-4 py-2.5">Scope</th>
                  <th className="px-4 py-2.5">Issued At</th>
                  <th className="px-4 py-2.5">Expires At</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeGrants.map((grant) => (
                  <tr key={grant.id} className="hover:bg-surface-raised/50">
                    <td className="px-4 py-3 font-medium text-fg">
                      {clientMap.get(grant.clientId) ?? grant.clientId}
                    </td>
                    <td className="px-4 py-3 font-mono text-muted">
                      {grant.familyId}
                    </td>
                    <td className="px-4 py-3 font-mono text-accent-1">
                      {grant.scope}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {DateTime.fromMillis(grant.createdAt, { zone }).toFormat(
                        "yyyy-LL-dd HH:mm",
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {DateTime.fromMillis(grant.expiresAt, { zone }).toFormat(
                        "yyyy-LL-dd HH:mm",
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <form action={revokeMcpFamilyAction}>
                        <input
                          type="hidden"
                          name="familyId"
                          value={grant.familyId}
                        />
                        <button
                          type="submit"
                          className="rounded border border-border px-2.5 py-1 text-xs text-red-400 transition-colors hover:border-red-500/50 hover:bg-red-500/10"
                        >
                          Revoke
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Audit Log */}
      <section>
        <h3 className="mb-3 font-mono text-xs uppercase tracking-widest text-muted">
          Recent Tool Audit Logs ({auditLogs.length})
        </h3>
        {auditLogs.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
            No tool invocations recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-surface-raised font-mono text-muted">
                <tr>
                  <th className="px-4 py-2.5">Time</th>
                  <th className="px-4 py-2.5">Tool</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Parameters</th>
                  <th className="px-4 py-2.5">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-surface-raised/50">
                    <td className="px-4 py-2.5 text-muted">
                      {DateTime.fromMillis(log.createdAt, { zone }).toFormat(
                        "HH:mm:ss",
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-fg">
                      {log.toolName}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={
                          log.status === "ok" ? "text-accent-4" : "text-red-400"
                        }
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="max-w-xs truncate px-4 py-2.5 text-muted">
                      {log.paramsSummary || "-"}
                    </td>
                    <td className="max-w-xs truncate px-4 py-2.5 text-red-400">
                      {log.errorMessage || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
