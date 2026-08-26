import { NextResponse } from "next/server";

import { siteUrl } from "@/lib/env";
import { deleteSession } from "@/lib/auth/session";

/** POST-only: a GET sign-out would be triggerable by any third-party <img>. */
export async function POST() {
  await deleteSession();
  return NextResponse.redirect(`${siteUrl()}/`, { status: 303 });
}
