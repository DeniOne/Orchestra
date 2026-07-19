import { SessionDetail } from '@/components/session-detail';
import Link from 'next/link';

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
        &larr; Назад к списку
      </Link>
      <SessionDetail id={id} />
    </div>
  );
}
