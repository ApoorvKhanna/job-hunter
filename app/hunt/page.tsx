import { redirect } from 'next/navigation'
import { readSession } from '@/lib/session'
import Hunt from './hunt'

export const dynamic = 'force-dynamic'

export default async function HuntPage() {
  const session = await readSession()
  if (!session) redirect('/')
  return <Hunt email={session.email ?? null} />
}
