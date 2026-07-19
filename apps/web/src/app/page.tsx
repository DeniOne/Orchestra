import { SessionList } from '@/components/session-list';
import { CreateSessionDialog } from '@/components/create-session-dialog';

export default function Home() {
  return (
    <>
      <SessionList />
      <CreateSessionDialog />
    </>
  );
}
