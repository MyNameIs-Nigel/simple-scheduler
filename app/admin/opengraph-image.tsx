import { openGraphImage, openGraphImageSize } from "@/lib/opengraph";

export const alt = "admin";
export const size = openGraphImageSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return openGraphImage("admin");
}
