import { openGraphImage, routeLabel } from "@/lib/opengraph";

export async function GET(_request: Request, { params }: { params: Promise<{ title: string }> }) {
  const { title } = await params;

  return openGraphImage(routeLabel(title));
}
