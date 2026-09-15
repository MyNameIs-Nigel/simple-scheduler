import { openGraphImage, openGraphImageSize } from "@/lib/opengraph";

export const alt = "Nigel Smith's Schedule";
export const size = openGraphImageSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return openGraphImage("schedule");
}
