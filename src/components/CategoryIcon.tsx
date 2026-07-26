/** Outline icons for the category rail. Stroke-based so they inherit colour. */
export default function CategoryIcon({
  name,
  className = "size-7",
}: {
  name: string;
  className?: string;
}) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
  };

  switch (name) {
    case "all":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
          <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
          <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
          <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" fill="currentColor" />
        </svg>
      );
    case "tower":
      return (
        <svg {...common}>
          <path d="M7 21 8.4 8" />
          <path d="M10 21 8.6 8" />
          <path d="M8.5 8 8.5 3" />
          <ellipse cx="8.5" cy="10.5" rx="3.2" ry="2.2" />
          <path d="M15.5 21 16.4 11" />
          <path d="M18 21 17.1 11" />
          <path d="M16.75 11 16.75 5.5" />
          <ellipse cx="16.75" cy="12.6" rx="2.4" ry="1.7" />
        </svg>
      );
    case "cutlery":
      return (
        <svg {...common}>
          <path d="M7 3v7a2 2 0 0 0 4 0V3" />
          <path d="M9 10v11" />
          <path d="M17 3c-1.6 1.2-2.4 3-2.4 5.2 0 1.6.8 2.6 2.4 2.8V21" />
        </svg>
      );
    case "burger":
      return (
        <svg {...common}>
          <path d="M4 9c0-2.8 3.6-5 8-5s8 2.2 8 5" />
          <path d="M4 9h16" />
          <path d="M4.5 13h15" />
          <path d="M4 16.5h16c0 1.9-1.6 3.5-3.5 3.5h-9C5.6 20 4 18.4 4 16.5Z" />
        </svg>
      );
    case "coffee":
      return (
        <svg {...common}>
          <path d="M4 9h13v5.5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" />
          <path d="M17 10.5h1.5a2.5 2.5 0 0 1 0 5H17" />
          <path d="M8 5.5c0-.9.8-1.3.8-2.2" />
          <path d="M12 5.5c0-.9.8-1.3.8-2.2" />
        </svg>
      );
    case "palm":
      return (
        <svg {...common}>
          <path d="M12 21c0-6 .4-10 1-13" />
          <path d="M13 8c-2.6-1.4-5.4-.9-7 1.4" />
          <path d="M13 8c2.6-1.6 5.6-1 7 1.2" />
          <path d="M13 8c-1.2-2.6-3.6-3.8-6.4-3.4" />
          <path d="M13 8c1.6-2.4 4.2-3.2 6.8-2.4" />
        </svg>
      );
    case "bag":
      return (
        <svg {...common}>
          <path d="M5.5 8h13l1 12.5h-15Z" />
          <path d="M9 8V6a3 3 0 0 1 6 0v2" />
        </svg>
      );
    case "masks":
      return (
        <svg {...common}>
          <path d="M3.5 5.5h8v6a4 4 0 0 1-8 0Z" />
          <path d="M12.5 5.5h8v6a4 4 0 0 1-8 0Z" />
          <path d="M5.8 8.6h.01M9.2 8.6h.01M14.8 8.6h.01M18.2 8.6h.01" />
          <path d="M6 18.5c1.6 1.4 3.4 2 6 2s4.4-.6 6-2" />
        </svg>
      );
    case "ferris":
      return (
        <svg {...common}>
          <circle cx="12" cy="10" r="7" />
          <circle cx="12" cy="10" r="2" />
          <path d="M12 3v14M5 10h14M7 5l10 10M17 5 7 15" />
          <path d="M8.5 21h7l-3.5-4Z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}
