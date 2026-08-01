import {
  IconBag,
  IconBurger,
  IconCutlery,
  IconDallah,
  IconFerris,
  IconGrid,
  IconMasks,
  IconPalm,
  IconTower,
} from "@/components/icons";

/** Maps a category's `icon` key to the shared icon system. */
export default function CategoryIcon({
  name,
  className = "size-7",
}: {
  name: string;
  className?: string;
}) {
  switch (name) {
    case "all":
      return <IconGrid className={className} />;
    case "tower":
      return <IconTower className={className} />;
    case "cutlery":
      return <IconCutlery className={className} />;
    case "burger":
      return <IconBurger className={className} />;
    case "coffee":
      return <IconDallah className={className} />;
    case "palm":
      return <IconPalm className={className} />;
    case "bag":
      return <IconBag className={className} />;
    case "masks":
      return <IconMasks className={className} />;
    case "ferris":
      return <IconFerris className={className} />;
    default:
      return <IconGrid className={className} />;
  }
}
