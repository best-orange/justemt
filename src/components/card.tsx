import Link from 'next/link';

interface CardProps {
  title: string;
  description: string;
  href: string;
  /** ISO 日期字符串，与 blog 库的输出保持一致 */
  date?: string;
  tags?: string[];
  isPrivate?: boolean;
  external?: boolean;
}

export default function Card({
  title,
  description,
  href,
  date,
  tags = [],
  isPrivate = false,
  external = false,
}: CardProps) {
  const dateStr = date
    ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(date))
    : undefined;

  const cardClass = 'glass group block rounded-2xl p-5 transition-transform duration-300 hover:-translate-y-0.5';

  const inner = (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate font-display font-bold text-slate-900 group-hover:text-violet-700 dark:text-white dark:group-hover:text-lilac-300">
            {title}
          </h3>
          {isPrivate && <span className="shrink-0 rounded-full bg-lilac-400/15 px-2 py-0.5 text-[10px] text-violet-700 dark:text-lilac-200">私密</span>}
        </div>
        {dateStr && <time className="shrink-0 text-sm text-slate-400">{dateStr}</time>}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        {description}
      </p>
      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span key={tag} className="rounded-full border border-lilac-400/30 px-2.5 py-0.5 text-xs text-lilac-500 dark:text-lilac-300">
              {tag}
            </span>
          ))}
        </div>
      )}
    </>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cardClass}>
        {inner}
      </a>
    );
  }

  return (
    <Link href={href} className={cardClass}>
      {inner}
    </Link>
  );
}