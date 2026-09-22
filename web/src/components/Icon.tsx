const FILE_PATH = "M3.5 1.5h6.25L13 4.75V14.5H3.5z";

const ICON_PATHS: Record<string, string> = {
  folder: "M1.5 3h5l1.25 1.5H14.5v8.5H1.5z",
  "folder-open":
    "M1.5 3.5h4.75l1 1.25H14v1.5H2.25zm.25 3.75L3.25 14h10.25l1.75-6.75z",
  chevron: "M6 4v8l6-4z",
  file: FILE_PATH,
  "file-html":
    FILE_PATH +
    "M6.7 6.15 4.55 8.5 6.7 10.85 5.75 11.6 3.15 8.5 5.75 5.4zM9.3 6.15 10.25 5.4 12.85 8.5 10.25 11.6 9.3 10.85 11.45 8.5z",
  "file-md":
    FILE_PATH +
    "M4.7 12.35V5.7h1.5l1.55 3.25 1.55-3.25h1.5v6.65H9.55V8.45L8.15 11.25h-.8L5.95 8.45v3.9z",
  search:
    "M7 2.25a4.75 4.75 0 1 1 0 9.5 4.75 4.75 0 0 1 0-9.5zm0 1.5a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5zM10.2 10.2l3.3 3.3-.95.95-3.3-3.3z",
  explorer: "M3 2h7.5v1.5H4.5v8.5H3zm2.5 2.5h7.5V15h-7.5z",
  collapse: "M2 2.5h1.75v11H2zm9.5.75L6 8l5.5 4.75z",
  empty: FILE_PATH,
};

const ICON_FILLS: Record<string, string> = {
  folder: "#dcb67a",
  "folder-open": "#dcb67a",
  file: "#6e6e6e",
  "file-html": "#e36e6e",
  "file-md": "#519aba",
};

export type IconName = keyof typeof ICON_PATHS;

export function fileIconName(path: string): IconName {
  const slash = path.lastIndexOf("/");
  const base = (slash < 0 ? path : path.slice(slash + 1)).toLowerCase();
  const dot = base.lastIndexOf(".");
  const ext = dot < 0 ? "" : base.slice(dot);
  if (ext === ".md") return "file-md";
  if (ext === ".html" || ext === ".htm") return "file-html";
  return "file";
}

type IconProps = {
  name: IconName;
  size?: number;
  className?: string;
};

export function Icon({ name, size = 16, className }: IconProps) {
  const d = ICON_PATHS[name];
  if (!d) return null;
  const fill = ICON_FILLS[name] || "currentColor";
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden
      className={`shrink-0 ${className ?? ""}`}
      fill={fill}
    >
      <path d={d} fillRule="evenodd" />
    </svg>
  );
}
