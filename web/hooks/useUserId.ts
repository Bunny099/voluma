'use client';
import { authClient } from '@/lib/auth-client';


export function useUserId(): string {
  const { data: session } = authClient.useSession();
  return session?.user?.id ?? '';
}